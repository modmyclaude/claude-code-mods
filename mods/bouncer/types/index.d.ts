// What bouncer keeps in $.state: every mod it checked, as the pane draws it;
// the band's line while a mod is new or changed; which row is unfolded; and
// when the last check ran.

/** What a mod can reach, read off Claude Code's validator report. Facts, never a verdict. */
export type BouncerReach = {
  files: 'none' | 'read' | 'read-write'
  processes: boolean
  network: boolean
  model: boolean
  sound: boolean
  env: boolean
  /** It reads settings ($.settings.read, $.config.list). */
  settings: boolean
  /** It changes Claude Code settings ($.config.set). */
  changesSettings: boolean
  /** It sets environment variables ($.env.set). */
  setsEnv: boolean
  /** It runs Claude's own tools, Bash and file writes among them ($.tool.call). */
  runsTools: boolean
  /** It calls MCP servers' tools ($.mcp.call, $.mcp.connect). */
  mcp: boolean
  /** It can spend your login on API calls ($.session.authorize). */
  usesLogin: boolean
  /** It starts subagents ($.agent.spawn). */
  startsAgents: boolean
  /** It adds a tool or a subagent type Claude can call ($.tool.register, $.agent.register). */
  addsTools: boolean
  /** It adds rows to the conversation ($.session.append). */
  addsToConversation: boolean
  /** It reads the conversation ($.session.messages, $.session.turns). */
  readsConversation: boolean
  /** It messages other sessions or agents ($.session.send). */
  messagesSessions: boolean
  /** It can end the running turn ($.turn.abort). */
  stopsTurns: boolean
  /** It writes your clipboard ($.ui.copy). */
  clipboard: boolean
  /** It can start a turn or fill the prompt box as if you typed. */
  typesForYou: boolean
  /** It hooks tool calls with a hook that can refuse or rewrite them. */
  changesToolCalls: boolean
  /** It hooks your prompts with a hook that can drop or rewrite them. */
  holdsPrompts: boolean
  /** It changes the system prompt or what is sent for the model. */
  changesPrompt: boolean
  /** The events it hooks, as the validator names them. */
  hooks: string[]
  /** Every $.noun.method it calls. */
  calls: string[]
  /** The validator's own lines, cleaned, for the details view. */
  notes: string[]
}

/** One checked mod: its report, or why it could not be checked. `isLoaded`: the engine named it joining this session. */
export type BouncerRow =
  | { ok: true; name: string; version?: string; root: string; isLoaded: boolean; reach: BouncerReach; hash: string; isNew: boolean; isChanged: boolean }
  | { ok: false; name: string; version?: string; root: string; isLoaded: boolean; reason: string }

declare module 'claude-code' {
  interface PluginState {
    bouncer: {
      /** Every mod checked, our own included, by name. */
      rows: BouncerRow[]
      /** The band's one line while a mod is new or changed this session, else null. */
      news: string | null
      /** The row whose validator lines are unfolded, by plugin folder, else null. */
      open: string | null
      /** When the last check finished, ms since the epoch; 0 before the first. */
      checkedAt: number
      /** A check is running now. */
      isChecking: boolean
    }
  }
}
