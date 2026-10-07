/*
 * Adapted from react-spinners ScaleLoader: static CSS replaces style injection.
 * Source: https://github.com/davidhu2000/react-spinners/blob/main/src/ScaleLoader.tsx
 *
 * The MIT License (MIT)
 * Copyright (c) 2017 David Hu
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import type { ComponentPropsWithoutRef, CSSProperties } from 'react';

type ScaleLoaderProps = ComponentPropsWithoutRef<'span'> & {
  loading?: boolean;
  color?: string;
  height?: number | string;
  width?: number | string;
  radius?: number | string;
  margin?: number | string;
  speedMultiplier?: number;
  barCount?: number;
  cssOverride?: CSSProperties;
};

export function ScaleLoader({loading = true, color = 'currentColor', height = 35, width = 4, radius = 2, margin = 2, speedMultiplier = 1, barCount = 5, cssOverride, style, className, ...props}: ScaleLoaderProps) {
  if (!loading) return null;
  return <span {...props} className={['ui-scale-loader', className].filter(Boolean).join(' ')} style={{display: 'inline-flex', alignItems: 'center', ...cssOverride, ...style}}>
    {Array.from({length: barCount}, (_, index) => <span key={index} style={{
      display: 'inline-block', backgroundColor: color, height, width, borderRadius: radius, margin,
      animation: `azcine-scale-loader ${1 / speedMultiplier}s ${(index + 1) * 0.1}s infinite cubic-bezier(0.2, 0.68, 0.18, 1.08) both`,
    }} />)}
  </span>;
}
