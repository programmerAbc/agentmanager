import type { Plugin } from 'vite'

/**
 * 构建时修补 @xterm/addon-webgl 0.19.0 的字形图集错乱（上游 xterm.js #4480，0.20 beta 已修，尚未发布正式版）。
 *
 * 现象：终端里的字显示成别的字或重叠的碎片（汉字多、颜色多、会话长时出现），换一次字号才恢复。
 * 根因：图集页写满后会把 4 页合并成 1 页，其余页下标前移；GlyphRenderer 按「页下标 + 页版本号」判断是否重新上传纹理，
 * 而版本号是每页各自从 0 数起的小整数。第二次合并时，新合并页（版本 1）正好落在第一次合并页原来的下标上、版本号也是 1，
 * 纹理不会重新上传，这一页上的字形全部从旧纹理取样。所有终端共用同一个图集，任一终端都可能触发。
 *
 * 修法与上游一致：
 * 1. 页版本号改为全局递增（新建 / 画入字形 / 下标平移 / 清空都取新号），不同页不会再撞号；
 * 2. 图集的 _requestClearModel 由布尔改为布局版本计数，每个 GlyphRenderer 记住自己看到的值，
 *    布局变化后（包括在隐藏期间）第一次渲染时整屏重建顶点数据；
 * 3. 一帧更新途中发生合并时，当帧立即整屏重建，不留一帧错字；
 * 4. 上传纹理时不超出纹理单元数（防御）。
 *
 * 按压缩后源码精确替换，任何一处没有恰好匹配一次就让构建失败。升级 addon-webgl 时先确认上游是否已修，已修就删除本插件。
 */
const TARGET = /[\\/]@xterm[\\/]addon-webgl[\\/]lib[\\/]addon-webgl\.mjs$/

/** 模块级的全局页版本号 */
const V = '__agentmanagerAtlasPageVersion'

const PATCHES: ReadonlyArray<readonly [search: string, replace: string]> = [
  // AtlasPage：新建、画入字形、清空取新版本号
  ['this._glyphs=[];this.version=0;', `this._glyphs=[];this.version=++${V};`],
  ['_.addGlyph(m),_.version++,m}', `_.addGlyph(m),_.version=++${V},m}`],
  ['this.fixedRows.length=0,this.version++}', `this.fixedRows.length=0,this.version=++${V}}`],
  // TextureAtlas._deletePage：后面的页下标前移
  ['for(let s of n.glyphs)s.texturePage--;n.version++}', `for(let s of n.glyphs)s.texturePage--;n.version=++${V}}`],
  // TextureAtlas：布局版本计数（beginFrame() 原样返回 _requestClearModel）；合并、超大页、清空图集时加一
  ['this._requestClearModel=!1;', 'this._requestClearModel=0;'],
  [
    'l.version++;for(let u=r.length-1;u>=0;u--)this._deletePage(r[u]);this.pages.push(l),this._requestClearModel=!0,',
    `l.version=++${V};for(let u=r.length-1;u>=0;u--)this._deletePage(r[u]);this.pages.push(l),this._requestClearModel++,`
  ],
  [
    'this.pages.push(this._overflowSizePage),this._requestClearModel=!0,',
    'this.pages.push(this._overflowSizePage),this._requestClearModel++,'
  ],
  [
    'this._cacheMapCombined.clear(),this._didWarmUp=!1}}',
    'this._cacheMapCombined.clear(),this._didWarmUp=!1,this._requestClearModel++}}'
  ],
  // GlyphRenderer：布局版本与上次不同才要求整屏重建；换图集时重置
  [
    'beginFrame(){return this._atlas?this._atlas.beginFrame():!0}',
    'beginFrame(){if(!this._atlas)return!0;let e=this._atlas.beginFrame();return e===this._amSeenLayout?!1:(this._amSeenLayout=e,!0)}'
  ],
  ['setAtlas(t){this._atlas=t;for(', 'setAtlas(t){this._atlas=t,this._amSeenLayout=void 0;for('],
  [
    'for(let r=0;r<this._atlas.pages.length;r++)',
    'for(let r=0;r<Math.min(this._atlas.pages.length,this._atlasTextures.length);r++)'
  ],
  // WebglRenderer.renderRows：更新途中布局变了（发生合并）就整屏重建，最多 3 次
  [
    'this._updateModel(0,this._terminal.rows-1)):this._updateModel(t,n),',
    'this._updateModel(0,this._terminal.rows-1)):this._updateModel(t,n),(()=>{for(let k=0;k<3&&this._glyphRenderer.value.beginFrame();k++)this._clearModel(!0),this._updateModel(0,this._terminal.rows-1)})(),'
  ]
]

export function xtermWebglAtlasFix(): Plugin {
  return {
    name: 'agentmanager:xterm-webgl-atlas-fix',
    enforce: 'pre',
    transform(code, id) {
      if (!TARGET.test(id.split('?')[0])) return null
      let patched = code
      for (const [search, replace] of PATCHES) {
        const count = patched.split(search).length - 1
        if (count !== 1) {
          throw new Error(
            `xterm-webgl-atlas-fix：在 ${id} 中找到 ${count} 处「${search}」（应为 1 处）。` +
              'addon-webgl 版本变了：确认上游是否已修复图集错乱（xterm.js #4480），已修复就删除本插件，否则按新源码更新替换规则。'
          )
        }
        patched = patched.replace(search, () => replace)
      }
      // 声明放在第一行（许可证注释之前），不改变行号
      return { code: `let ${V}=0;${patched}`, map: null }
    }
  }
}
