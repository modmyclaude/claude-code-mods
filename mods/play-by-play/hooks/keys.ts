// The replay pane's key line: a Client region that hands the hooks module the
// keys pressed while it has the focus (a click gives it), since a pane's own
// Buttons take only letter and digit hotkeys, never the arrows.

import type { ClientModule } from 'claude-code'

const Keys: ClientModule<{ hint: string }> = (props, surface) => {
  surface.onKey(event => {
    if (event.ctrl !== true && event.meta !== true) surface.post({ key: event.key })
  })
  return surface.elements.Text({ dimColor: true, children: props.hint })
}

export default Keys
