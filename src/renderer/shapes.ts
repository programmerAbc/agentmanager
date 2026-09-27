// MD3 Expressive 风格的圆角形状（cookie / burst / 多边形 / 椭圆），用极坐标采样生成平滑闭合路径。
// 所有形状使用相同的点数，路径命令结构一致，可以直接在它们之间做路径变形动画。

const SVG_NS = 'http://www.w3.org/2000/svg'
const POINTS = 48

type RadiusFn = (theta: number) => number

const wave = (lobes: number, depth: number): RadiusFn => (t) => (1 + depth * Math.cos(lobes * t)) / (1 + depth)

export const SHAPES = {
  cookie12: wave(12, 0.06),
  cookie9: wave(9, 0.075),
  softBurst: wave(10, 0.1),
  pentagon: wave(5, 0.1),
  cookie4: wave(4, 0.13),
  sunny: wave(8, 0.055),
  oval: (t: number) => 0.78 / Math.sqrt((0.78 * Math.cos(t)) ** 2 + Math.sin(t) ** 2)
} satisfies Record<string, RadiusFn>

export type ShapeName = keyof typeof SHAPES

/** 生成 24×24 视口内的闭合路径（Catmull-Rom 转三次贝塞尔） */
export function shapePath(name: ShapeName, rotation = 0): string {
  const fn = SHAPES[name]
  const pts: [number, number][] = []
  for (let i = 0; i < POINTS; i++) {
    const t = (i / POINTS) * Math.PI * 2
    const r = 11 * fn(t)
    pts.push([12 + r * Math.cos(t + rotation), 12 + r * Math.sin(t + rotation)])
  }
  const f = (n: number): string => n.toFixed(2)
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < POINTS; i++) {
    const p0 = pts[(i - 1 + POINTS) % POINTS]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % POINTS]
    const p3 = pts[(i + 2) % POINTS]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`
  }
  return `${d}Z`
}

/** 静态形状 SVG */
export function shapeSvg(name: ShapeName, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', className)
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', shapePath(name))
  path.setAttribute('fill', 'currentColor')
  svg.appendChild(path)
  return svg
}

/**
 * MD3 Expressive 加载指示器：在几种形状之间变形并旋转。
 * 使用 SVG SMIL（路径结构一致即可插值），不依赖动画库。
 */
export function loadingIndicator(className = 'loading-indicator'): SVGSVGElement {
  const sequence: ShapeName[] = ['softBurst', 'cookie9', 'pentagon', 'oval', 'sunny', 'cookie4', 'softBurst']
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', className)
  svg.setAttribute('aria-hidden', 'true')
  const g = document.createElementNS(SVG_NS, 'g')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('fill', 'currentColor')
  path.setAttribute('d', shapePath(sequence[0]))

  const morph = document.createElementNS(SVG_NS, 'animate')
  morph.setAttribute('attributeName', 'd')
  morph.setAttribute('dur', '4.2s')
  morph.setAttribute('repeatCount', 'indefinite')
  morph.setAttribute('values', sequence.map((s) => shapePath(s)).join(';'))
  morph.setAttribute('calcMode', 'spline')
  const steps = sequence.length - 1
  morph.setAttribute('keyTimes', Array.from({ length: sequence.length }, (_, i) => (i / steps).toFixed(4)).join(';'))
  // 每段用强调缓动（SMIL 的控制点限制在 0–1，做不了回弹；回弹感由旋转与变形叠加体现）
  morph.setAttribute('keySplines', Array(steps).fill('0.42 0 0.2 1').join(';'))
  path.appendChild(morph)

  const spin = document.createElementNS(SVG_NS, 'animateTransform')
  spin.setAttribute('attributeName', 'transform')
  spin.setAttribute('type', 'rotate')
  spin.setAttribute('from', '0 12 12')
  spin.setAttribute('to', '360 12 12')
  spin.setAttribute('dur', '2.8s')
  spin.setAttribute('repeatCount', 'indefinite')
  g.appendChild(spin)

  g.appendChild(path)
  svg.appendChild(g)
  return svg
}
