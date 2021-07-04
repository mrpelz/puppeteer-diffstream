import { mkdir, rm } from 'fs';
import { Stream } from './stream.js';
import WebSocket from 'ws';
import { promisify } from 'util';
import puppeteer from 'puppeteer';

const debug = false;
const port = 1337;

export const screenshotPath = './dist/screenshots';

const wss = new WebSocket.Server({ host: '0.0.0.0', port });

wss.on('listening', () => {
  // eslint-disable-next-line no-console
  console.info('wss listening');
});

(async () => {
  const browser = await puppeteer.launch({
    args: [
      '--disable-overscroll-edge-effect',
      '--disable-pull-to-refresh-effect',
      '--no-startup-window',
    ],
    waitForInitialPage: false,
  });

  wss.on('connection', (ws, request) => {
    // eslint-disable-next-line no-console
    console.info('ws connection');

    const abort = () => {
      ws.close();
      request.destroy();
    };

    if (!request.url) {
      abort();
      return;
    }

    const query = new URL(request.url, 'http://localhost').searchParams;

    const url = query.get('url');
    if (!url) {
      abort();
      return;
    }

    const colors = query.get('colors');
    const width = query.get('width');
    const height = query.get('height');
    const depth = query.get('depth');
    const dpr = query.get('dpr');
    const timeout = query.get('timeout');

    const size = Boolean(width && height);

    try {
      const stream = new Stream(
        browser,
        new URL(url),
        timeout ? Number(timeout) : undefined,
        colors ? 'grayscale' : 'rgb',
        colors ? Number(colors) : undefined,
        depth ? Number(depth) : undefined,
        size
          ? {
              height: Number(height),
              width: Number(width),
            }
          : undefined,
        dpr ? Number(dpr) : undefined,
        debug
      );

      stream.setCallback((data) => ws.send(data));

      ws.on('message', (input) => {
        if (!(input instanceof Buffer)) return;
        stream.touch(input);
      });

      ws.on('close', () => {
        // eslint-disable-next-line no-console
        console.info('ws close');

        abort();
        stream.close();
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);

      abort();
    }
  });

  await promisify(rm)(screenshotPath, { force: true, recursive: true });

  if (debug) {
    await promisify(mkdir)(screenshotPath);
  }

  // eslint-disable-next-line no-console
  console.info('startup done');
})();
