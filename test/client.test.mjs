/**
 * Web 客户端模块自测：不依赖真实浏览器与 DSH 运行。
 *
 * 用假的 __ModuleLoader__ 捕获 factory，再用假 React / 假 slots 上下文执行 apply，
 * 验证两个槽位注册（sidebar.panellist + main）与 id/key 对应关系。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const loaded = []
globalThis.window = {
  __ModuleLoader__: {
    load(spec) { loaded.push(spec) },
  },
}

await import('../client.js')

class FakeComponent {
  constructor(props) { this.props = props }
  setState() {}
}

function fakeRequire(name) {
  assert.equal(name, 'react')
  return {
    createElement: () => null,
    Component: FakeComponent,
    useState: () => [undefined, () => {}],
    useCallback: (fn) => fn,
    useEffect: () => {},
    useRef: () => ({ current: null }),
  }
}

describe('Web 客户端面板', () => {
  it('以包名注册客户端模块', () => {
    assert.equal(loaded.length, 1)
    assert.equal(loaded[0].id, '@local/dsh-wps365')
    assert.equal(typeof loaded[0].factory, 'function')
  })

  it('导出的插件对象与 Host 插件同名、只依赖 slots', () => {
    const plugin = loaded[0].factory(fakeRequire)
    assert.equal(plugin.name, '@local/dsh-wps365')
    assert.deepEqual(plugin.inject, ['slots'])
    assert.equal(typeof plugin.apply, 'function')
  })

  it('注册侧栏图标与中央面板两个槽位', () => {
    const plugin = loaded[0].factory(fakeRequire)
    const injected = []
    const registered = []
    const ctx = {
      slots: {
        inject(slot, register) {
          injected.push(slot)
          register()
        },
        register(definition, component) {
          registered.push({ definition, component })
          return () => {}
        },
      },
      effect() {},
      logger: { warn() {} },
    }
    plugin.apply(ctx)

    assert.deepEqual(injected, ['sidebar.panellist', 'main'])

    const sidebar = registered.find((entry) => entry.definition.name === 'sidebar.panellist')
    assert.ok(sidebar, '应注册 sidebar.panellist')
    assert.equal(sidebar.definition.id, 'wps365')
    assert.equal(typeof sidebar.definition.label, 'function')
    assert.equal(typeof sidebar.component, 'function')

    const main = registered.find((entry) => entry.definition.name === 'main')
    assert.ok(main, '应注册 main')
    assert.equal(main.definition.key, 'wps365')
    assert.equal(typeof main.component, 'function')
  })
})
