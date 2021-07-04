import sharp, { Sharp } from 'sharp';

export type Position = {
  x: number;
  y: number;
};

export type Dimensions = {
  height: number;
  width: number;
};

export type Rect = Dimensions & Position;

export type ImageData = {
  data: Buffer;
} & Dimensions;

export type ColorType = 'rgb' | 'grayscale';

function equalPixel(a: Buffer, b: Buffer, channels: number) {
  for (let channel = 0; channel < channels; channel += 1) {
    if (a[channel] !== b[channel]) return false;
  }

  return true;
}

export async function toImage(
  input: string,
  grayscale: boolean
): Promise<Sharp> {
  const data = Buffer.from(input, 'base64');

  const rgbScreenshot = sharp(data).removeAlpha();
  return grayscale
    ? rgbScreenshot.toColorspace('b-w').grayscale()
    : rgbScreenshot;
}

export async function toRaw(input: Sharp): Promise<ImageData> {
  const {
    data,
    info: { height, width },
  } = await input.raw().toBuffer({ resolveWithObject: true });

  return {
    data,
    height,
    width,
  };
}

export function getPixel(
  { data, height, width }: ImageData,
  { x, y }: Position,
  channels: number
): Buffer {
  if (!data.length || width <= 0 || height <= 0 || x < 0 || y < 0) {
    throw new Error('invalid input');
  }

  const column = Math.min(x, width - 1);
  const row = Math.min(y, height - 1);

  const pointer = (column + row * width) * channels;

  return data.slice(pointer, pointer + channels);
}

function fullChange(a: ImageData, b: ImageData, channels: number) {
  const { height, width } = b;

  return (
    !equalPixel(
      getPixel(a, { x: 0, y: 0 }, channels),
      getPixel(b, { x: 0, y: 0 }, channels),
      channels
    ) &&
    !equalPixel(
      getPixel(a, { x: width, y: 0 }, channels),
      getPixel(b, { x: width, y: 0 }, channels),
      channels
    ) &&
    !equalPixel(
      getPixel(a, { x: width, y: height }, channels),
      getPixel(b, { x: width, y: height }, channels),
      channels
    ) &&
    !equalPixel(
      getPixel(a, { x: 0, y: height }, channels),
      getPixel(b, { x: 0, y: height }, channels),
      channels
    )
  );
}

function partialChange(a: ImageData, b: ImageData, channels: number) {
  const { height, width } = b;

  const minX = 0;
  const maxX = width - 1;

  const minY = 0;
  const maxY = height - 1;

  let edgeTop = maxY;
  let edgeRight = minX;
  let edgeBottom = minY;
  let edgeLeft = maxX;

  for (let currentY = minY; currentY <= maxY; currentY += 1) {
    for (let currentX = minX; currentX <= maxX; currentX += 1) {
      if (currentX > edgeLeft) continue;

      if (
        !equalPixel(
          getPixel(a, { x: currentX, y: currentY }, channels),
          getPixel(b, { x: currentX, y: currentY }, channels),
          channels
        )
      ) {
        if (currentX < edgeLeft) edgeLeft = currentX;
        if (currentY < edgeTop) edgeTop = currentY;
      }
    }
  }

  for (let currentX = maxX; currentX >= minX; currentX -= 1) {
    for (let currentY = maxY; currentY >= minY; currentY -= 1) {
      if (currentY < edgeBottom) continue;

      if (
        !equalPixel(
          getPixel(a, { x: currentX, y: currentY }, channels),
          getPixel(b, { x: currentX, y: currentY }, channels),
          channels
        )
      ) {
        if (currentX > edgeRight) edgeRight = currentX;
        if (currentY > edgeBottom) edgeBottom = currentY;
      }
    }
  }

  const hasOddStart = Boolean(edgeLeft % 2);
  const effectiveX = hasOddStart ? edgeLeft - 1 : edgeLeft;

  let effectiveWidth = edgeRight - effectiveX + 1;

  const hasOddEnd = Boolean(effectiveWidth % 2);
  if (hasOddEnd) effectiveWidth += 1;

  return {
    height: edgeBottom - edgeTop + 1,
    width: effectiveWidth,
    x: effectiveX,
    y: edgeTop,
  };
}

export function diff(
  a: ImageData | null,
  b: ImageData,
  channels: number
): Rect | null {
  const { data, height, width } = b;

  if (a && data.equals(a.data)) return null;

  if (!a || a.data.length !== data.length || fullChange(a, b, channels)) {
    return {
      height,
      width,
      x: 0,
      y: 0,
    };
  }

  return partialChange(a, b, channels);
}

export async function remapColors(
  input: Sharp,
  colorSteps: null | number,
  depth = 255
): Promise<Buffer> {
  const { data } = await toRaw(input);

  if (!colorSteps || colorSteps <= 1) return data;

  const colorStepsIndex = colorSteps - 1;

  return Buffer.from(
    data.map((value) => {
      const quantized = Math.round((value * colorStepsIndex) / 255);

      if (colorStepsIndex === depth) return quantized;

      return quantized * (255 / colorStepsIndex);
    })
  );
}

export function pack(data: Buffer, difference: Rect): Buffer {
  const { height, width } = difference;

  const result: number[] = [];

  const maxX = Math.trunc(width / 2) - 1;
  const maxY = height - 1;

  for (let y = 0; y <= maxY; y += 1) {
    for (let x = 0; x <= maxX; x += 1) {
      const pixel0 = getPixel({ data, height, width }, { x, y }, 1)[0];
      const pixel1 = getPixel({ data, height, width }, { x: x * 2, y }, 1)[0];

      // eslint-disable-next-line no-bitwise
      result.push((pixel0 << 0b00001111) | pixel1);
    }
  }

  return Buffer.from(result);
}
