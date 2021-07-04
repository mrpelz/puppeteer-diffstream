// eslint-disable-next-line @typescript-eslint/no-unused-vars
const webSocket = (() => {
  const style = document.createElement('style');
  style.innerHTML = `
    * {
      margin: 0;
      padding: 0;
    }
  `;

  const canvas = document.createElement('canvas');
  canvas.width = innerWidth;
  canvas.height = innerHeight;

  document.head.append(style);
  document.body.append(canvas);

  const context = canvas.getContext('2d');
  if (!context) return null;

  const wsUrl = new URL('ws://localhost:1337');

  wsUrl.searchParams.append(
    'url',
    'https://iot.i.wurstsalat.cloud/#dao=1&swo=0&olo=1&pao=7'
  );
  wsUrl.searchParams.append('width', innerWidth);
  wsUrl.searchParams.append('height', innerHeight);
  wsUrl.searchParams.append('dpr', 2);
  wsUrl.searchParams.append('timeout', 1000);

  const ws = new WebSocket(wsUrl.href);
  ws.onmessage = async (event) => {
    const buffer = await event.data.arrayBuffer();

    const [x, y, width, height] = new Uint32Array(buffer, 0, 16);
    const rgbImage = new Uint8ClampedArray(buffer, 16);

    // eslint-disable-next-line no-console
    console.log({ height, width, x, y });

    const rgbaImage = new ImageData(width, height);

    for (let index = 0; index < width * height; index += 1) {
      const rgbPointer = index * 3;
      const rgbaPointer = index * 4;

      rgbaImage.data.set(
        [...rgbImage.slice(rgbPointer, rgbPointer + 3), 0xff],
        rgbaPointer
      );
    }

    context.putImageData(rgbaImage, x, y);
  };

  let down = false;

  document.addEventListener('mouseup', (event) => {
    down = false;

    if (ws.readyState !== ws.OPEN) return;

    const { offsetX, offsetY } = event;
    if (!offsetX || !offsetY) return;

    ws.send(new Uint32Array([0, offsetX, offsetY]));
  });

  document.addEventListener('mousedown', (event) => {
    down = true;

    if (ws.readyState !== ws.OPEN) return;

    const { offsetX, offsetY } = event;
    if (!offsetX || !offsetY) return;

    ws.send(new Uint32Array([1, offsetX, offsetY]));
  });

  document.addEventListener('mousemove', (event) => {
    if (!down || ws.readyState !== ws.OPEN) return;

    const { offsetX, offsetY } = event;
    if (!offsetX && !offsetY) {
      ws.send(new Uint32Array([0, offsetX, offsetY]));
      return;
    }

    ws.send(new Uint32Array([2, offsetX, offsetY]));
  });

  return ws;
})();
