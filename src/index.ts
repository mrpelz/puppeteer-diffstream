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

    const queryAsNumber = (name: string) => {
      const rawValue = query.get(name);
      if (!rawValue) return undefined;

      const value = Number.parseInt(rawValue, 10);
      if (Number.isNaN(value)) return undefined;

      return value;
    };

    try {
      const stream = new Stream(
        browser,
        new URL(url),
        queryAsNumber('timeout'),
        queryAsNumber('colors') ? 'grayscale' : 'rgb',
        queryAsNumber('colors'),
        queryAsNumber('depth'),
        Boolean(queryAsNumber('rgb16')),
        {
          height: queryAsNumber('height'),
          width: queryAsNumber('width'),
        },
        queryAsNumber('dpr'),
        debug
      );

      stream.setCallback((data) => ws.send(data));

      ws.on('message', (input) => {
        if (!(input instanceof Buffer)) return;
        stream.injectIncomingEvent(input);
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

  // // eslint-disable-next-line no-new
  // new Stream(
  //   browser,
  //   new URL('https://iot.i.wurstsalat.cloud/#dao=0&swo=0&olo=1&pao=0'),
  //   5000,
  //   'grayscale',
  //   2,
  //   undefined,
  //   false,
  //   {
  //     height: 528,
  //     width: 880,
  //   },
  //   2,
  //   debug
  // );

  // eslint-disable-next-line no-console
  console.info('startup done');
})();
