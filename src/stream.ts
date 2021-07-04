import { Browser, CDPSession, Page, Viewport } from 'puppeteer';
import {
  ColorType,
  ImageData,
  Rect,
  diff,
  pack,
  remapColors,
  toImage,
  toRaw,
} from './util.js';
import { join } from 'path';
import { mkdir } from 'fs';
import { promisify } from 'util';
import { screenshotPath } from './index.js';
import sharp from 'sharp';

type Callback = (data: Buffer) => void;

export const defaultViewport: Viewport = {
  deviceScaleFactor: 1,
  hasTouch: true,
  height: 768,
  isLandscape: true,
  isMobile: true,
  width: 1024,
};

let index = 0;

export class Stream {
  private _callback: Callback | null = null;
  private _cdp: CDPSession | null = null;
  private readonly _colorGrayscale: boolean;
  private readonly _colorSteps?: number;
  private readonly _debug: boolean;
  private readonly _depth: number;
  private _downX = -1;
  private _downY = -1;
  private readonly _dpr: number;
  private _frame = 0;
  private readonly _index: number;
  private _isInteracting: boolean;
  private _page: Page | null = null;
  private _previousImage: ImageData | null = null;
  private _runningTimeout: NodeJS.Timeout | null = null;
  private readonly _timeout: number;

  constructor(
    browser: Browser,
    url: URL,
    timeout = 250,
    colorType: ColorType,
    colorSteps?: number,
    depth = 255,
    viewport?: Partial<Viewport>,
    dpr?: number,
    debug?: boolean
  ) {
    if ((viewport?.width || 0) % 2) {
      throw new Error('width not even number');
    }
    if ((viewport?.height || 0) % 2) {
      throw new Error('height not even number');
    }

    this._timeout = timeout;
    this._colorGrayscale = colorType === 'grayscale';
    this._colorSteps = colorSteps;
    this._depth = depth;

    this._dpr = dpr && !(dpr % 2) ? dpr : 0;

    this._debug = Boolean(debug);

    this._index = index;
    index += 1;

    this._screenshot = this._screenshot.bind(this);

    (async () => {
      const effectiveViewport = { ...defaultViewport, ...viewport };

      if (this._debug) {
        await promisify(mkdir)(join(screenshotPath, `${this._index}`));
      }

      this._page = await browser.newPage();
      await this._page.setViewport(effectiveViewport);

      this._cdp = await this._page.target().createCDPSession();
      await this._cdp.send('Page.enable');

      if (this._dpr) {
        await this._cdp.send('Page.setDeviceMetricsOverride', {
          deviceScaleFactor: this._dpr,
          height: effectiveViewport.height / this._dpr,
          mobile: Boolean(effectiveViewport.isMobile),
          width: effectiveViewport.width / this._dpr,
        });
      }

      try {
        await this._page.goto(url.href);
        await this._screenshot();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
      }
    })();
  }

  private async _handleTouchend(x: number, y: number) {
    if (!this._cdp || !this._page || !this._isInteracting) return;
    this._isInteracting = false;

    const noMovementInteraction =
      (!x && !y) || (x === this._downX && y === this._downY);

    this._downX = -1;
    this._downY = -1;

    if (noMovementInteraction) {
      await this._cdp.send('Input.dispatchTouchEvent', {
        touchPoints: [],
        type: 'touchEnd',
      });

      return;
    }

    await this._page.mouse.click(x, y);
    await this._screenshot();
  }

  private async _handleTouchmove(x: number, y: number) {
    if (!this._cdp || !this._isInteracting) return;

    this._downX = x;
    this._downY = y;

    await this._cdp.send('Input.dispatchTouchEvent', {
      touchPoints: [{ x, y }],
      type: 'touchMove',
    });
  }

  private async _handleTouchstart(x: number, y: number) {
    if (!this._cdp) return;
    this._isInteracting = true;

    this._downX = x;
    this._downY = y;

    await this._cdp.send('Input.dispatchTouchEvent', {
      touchPoints: [{ x, y }],
      type: 'touchStart',
    });
  }

  private _packageUpdate(data: Buffer, rect: Rect): Buffer {
    const headerField = (value: number) => {
      const result = Buffer.alloc(4);
      result.writeUInt32LE(value);

      return result;
    };

    const { height, width, x, y } = rect;

    return Buffer.concat([
      headerField(x),
      headerField(y),
      headerField(width),
      headerField(height),
      data,
    ]);
  }

  private async _screenshot() {
    if (!this._cdp) return;

    if (this._runningTimeout) {
      clearTimeout(this._runningTimeout);
      this._runningTimeout = null;
    }

    const { data } = await this._cdp.send('Page.captureScreenshot', {
      format: 'png',
    });

    await this._handleScreenshot(data);

    this._runningTimeout = setTimeout(
      this._screenshot,
      this._isInteracting ? this._timeout / 10 : this._timeout
    );
  }

  private _writeDebugOutput(input: Buffer, rect: Rect, frame: number) {
    const { height, width, x, y } = rect;

    sharp(input, {
      raw: {
        channels: this._colorGrayscale ? 1 : 3,
        height,
        width,
      },
    })
      .png()
      .toFile(join(screenshotPath, `${this._index}`, `${frame}_${x},${y}.png`));
  }

  async _handleScreenshot(data: string): Promise<void> {
    try {
      const thisFrame = this._frame;
      this._frame += 1;

      const screenshot = await toImage(data, this._colorGrayscale);
      const image = await toRaw(screenshot);

      const difference = diff(
        this._previousImage,
        image,
        this._colorGrayscale ? 1 : 3
      );

      this._previousImage = image;

      if (difference) {
        // eslint-disable-next-line no-console
        console.info(this._index, thisFrame, JSON.stringify(difference));

        const { height, width, x: left, y: top } = difference;
        const extract = await screenshot.extract({ height, left, top, width });

        if (!this._callback) return;

        const mapped = await remapColors(
          extract,
          this._colorGrayscale && this._colorSteps ? this._colorSteps : null,
          this._depth
        );

        const packed = this._colorSteps ? pack(mapped, difference) : mapped;

        if (thisFrame + 1 !== this._frame) return;

        this._callback(this._packageUpdate(packed, difference));

        if (!this._debug) return;

        this._writeDebugOutput(
          await remapColors(
            extract,
            this._colorGrayscale && this._colorSteps ? this._colorSteps : null
          ),
          difference,
          thisFrame
        );
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }

  async close(): Promise<void> {
    if (this._runningTimeout) {
      clearInterval(this._runningTimeout);
      this._runningTimeout = null;
    }

    if (!this._page) return;
    await this._page.close();

    this._page = null;
  }

  setCallback(callback: Callback): void {
    this._callback = callback;
  }

  async touch(input: Buffer): Promise<void> {
    if (input.length < 12) return;

    try {
      const type = input.readUInt32LE(0) as 0 | 1 | 2;
      const x = input.readUInt32LE(4);
      const y = input.readUInt32LE(8);

      // eslint-disable-next-line no-console
      console.info(JSON.stringify({ type, x, y }));

      if (type > 2 || x === null || y === null) return;

      const effectiveX = this._dpr ? x / this._dpr : x;
      const effectiveY = this._dpr ? y / this._dpr : y;

      // eslint-disable-next-line default-case
      switch (type) {
        case 0:
          this._handleTouchend(effectiveX, effectiveY);
          break;
        case 1:
          this._handleTouchstart(effectiveX, effectiveY);
          break;
        case 2:
          this._handleTouchmove(effectiveX, effectiveY);
      }
    } catch {
      // noop
    }
  }
}
