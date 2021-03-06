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
  private _paused = false;
  private _previousImage: ImageData | null = null;
  private readonly _rgb16: boolean;
  private _runningTimeout: NodeJS.Timeout | null = null;
  private readonly _timeout: number;

  constructor(
    browser: Browser,
    url: URL,
    timeout = 250,
    colorType: ColorType,
    colorSteps?: number,
    depth = 255,
    rgb16 = false,
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
    this._rgb16 = rgb16;

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

        // disable smooth font rendering when only 1bit color is available
        if (
          this._colorGrayscale &&
          this._colorSteps &&
          this._colorSteps === 2
        ) {
          await this._page.addStyleTag({
            content: `
              :root {
                -webkit-font-smoothing: none;
                font-smooth: none;
              }
            `.trim(),
          });
        }

        await this._screenshot();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`could not setup page: ${error}`);
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

    if (!noMovementInteraction) {
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
    if (this._paused || !this._cdp) return;

    if (this._runningTimeout) {
      clearTimeout(this._runningTimeout);
      this._runningTimeout = null;
    }

    const { data } = await this._cdp.send('Page.captureScreenshot', {
      format: 'png',
    });

    await this._handleScreenshot(data);

    this._runningTimeout = setTimeout(this._screenshot, this._timeout);
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

        if (this._debug) {
          this._writeDebugOutput(
            await remapColors(
              extract,
              this._colorGrayscale && this._colorSteps ? this._colorSteps : null
            ),
            difference,
            thisFrame
          );
        }

        if (!this._callback) return;

        const mapped = await remapColors(
          extract,
          this._colorGrayscale && this._colorSteps ? this._colorSteps : null,
          this._depth,
          this._rgb16
        );

        const packed = this._colorSteps ? pack(mapped, difference) : mapped;

        if (thisFrame + 1 !== this._frame) return;

        this._callback(this._packageUpdate(packed, difference));
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`could not calculate diff update: ${error}`);
    }
  }

  async close(): Promise<void> {
    this.stopUpdates();

    if (!this._page) return;
    await this._page.close();

    this._page = null;
  }

  async injectIncomingEvent(input: Buffer): Promise<void> {
    if (input.length < 4) return;

    try {
      const type = input.readUInt32LE(0) as 0 | 1 | 2 | 3 | 4;

      // eslint-disable-next-line no-console
      if (type >= 3) console.info(JSON.stringify({ type }));

      // eslint-disable-next-line default-case
      switch (type) {
        case 3:
          this._paused = true;
          this.stopUpdates();
          return;
        case 4:
          this._paused = false;
          this._screenshot();
          return;
      }

      if (input.length < 12) return;

      const x = input.readUInt32LE(4);
      const y = input.readUInt32LE(8);

      // eslint-disable-next-line no-console
      console.info(JSON.stringify({ type, x, y }));

      if (type > 2 || x === null || y === null) return;

      // eslint-disable-next-line default-case
      switch (type) {
        case 0:
          this._handleTouchend(x, y);
          break;
        case 1:
          this._handleTouchstart(x, y);
          break;
        case 2:
          this._handleTouchmove(x, y);
          break;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`could not handle incoming data: ${error}`);
    }
  }

  setCallback(callback: Callback): void {
    this._callback = callback;
  }

  stopUpdates(): void {
    if (this._runningTimeout) {
      clearInterval(this._runningTimeout);
      this._runningTimeout = null;
    }
  }
}
