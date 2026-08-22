/**
 * Chat drawer — the M7 Q&A agent's UI. Sends the question to the bridge
 * (POST /api/ask -> OpenCodeClient -> opencode serve), renders the answer,
 * the tool-call chips (the audit-visible evidence of read-only allowlisted
 * tools), and a clear "agent offline" state when opencode serve is down.
 *
 * The LLM enters ONLY here — every other screen is deterministic rendering.
 */

import { Bot, Loader2, Send, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/chat/Textarea'
import { askQuestion, AgentOfflineError, getHealth, wakeAgent } from '@/lib/api'
import type { AskResponse } from '@/types/bridge'
import { cn } from '@/lib/utils'

type Message =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; toolCalls: Array<{ tool: string; status: string }>; withinBudget: boolean }
  | { kind: 'system'; text: string }

const SUGGESTIONS = [
  'How many holdings do I have?',
  'What is my total portfolio value?',
  'Which platforms hold my moomoo positions?',
]

export function ChatDrawer({
  onClose,
  hasAgentData,
}: {
  onClose: () => void
  hasAgentData: boolean
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Agent state machine: null = checking, false + waking = starting,
  // false = offline, true = online.
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null)
  const [waking, setWaking] = useState(false)
  const [wakeError, setWakeError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  /**
   * Best-effort wake of opencode serve via the bridge. Never awaited before
   * showing UI. On resolve we optimistically mark the agent online — wake
   * returns immediately and /api/health flips within seconds, so a send that
   * still 503s is caught by AgentOfflineError and shown honestly.
   */
  const fireWake = useCallback(() => {
    setWaking(true)
    setWakeError(null)
    wakeAgent()
      .then(() => {
        setAgentOnline(true)
        setWaking(false)
      })
      .catch((err: unknown) => {
        setWakeError(err instanceof Error ? err.message : String(err))
        setWaking(false)
      })
  }, [])

  useEffect(() => {
    let cancelled = false
    getHealth()
      .then((h) => {
        if (cancelled) return
        setAgentOnline(h.agent)
        // Auto-wake on open (user choice): the drawer opening starts serve.
        if (!h.agent) fireWake()
      })
      .catch(() => {
        // Bridge itself unreachable — a wake would fail too; the manual
        // "Wake agent" button is available for a retry.
        if (!cancelled) setAgentOnline(false)
      })
    return () => {
      cancelled = true
    }
  }, [fireWake])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  // Esc closes the drawer while it is mounted. Non-modal by design — no focus
  // trap; the AppShell restores focus to the header toggle on close.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function send(text: string) {
    const question = text.trim()
    if (!question || busy) return
    setMessages((m) => [...m, { kind: 'user', text: question }])
    setInput('')
    setBusy(true)
    try {
      const res: AskResponse = await askQuestion(question)
      setMessages((m) => [
        ...m,
        { kind: 'assistant', text: res.answer, toolCalls: res.toolCalls, withinBudget: res.withinBudget },
      ])
      setAgentOnline(true)
    } catch (err) {
      if (err instanceof AgentOfflineError) {
        setAgentOnline(false)
        setMessages((m) => [
          ...m,
          {
            kind: 'system',
            text: 'The agent is starting or still offline — wait a few seconds and ask again.',
          },
        ])
      } else {
        setMessages((m) => [
          ...m,
          {
            kind: 'system',
            text: `Something went wrong talking to the agent: ${err instanceof Error ? err.message : String(err)}`,
          },
        ])
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside
      aria-label="Portfolio analyst chat"
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-card animate-chat-in sm:top-12 sm:left-auto sm:w-[400px] sm:border-l sm:shadow-lg"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <span className="text-sm font-medium">Portfolio analyst</span>
          <span
            className={cn(
              'ml-1 size-1.5 rounded-full',
              agentOnline === null
                ? 'bg-muted-foreground'
                : agentOnline
                  ? 'bg-gain'
                  : waking
                    ? 'bg-warning'
                    : 'bg-loss',
            )}
            title={
              agentOnline === null
                ? 'checking…'
                : agentOnline
                  ? 'agent online'
                  : waking
                    ? 'agent starting…'
                    : 'agent offline'
            }
          />
        </div>
        <Button variant="ghost" size="icon" className="size-7 cursor-pointer" onClick={onClose} aria-label="Close chat">
          <X className="size-4" />
        </Button>
      </div>

      {agentOnline === false && (
        <div role="status" className="border-b border-loss/30 bg-loss/10 px-4 py-2 text-xs text-loss">
          {waking ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-3 animate-spin" />
              <span>
                Starting the analyst…
                {wakeError && <span> (couldn't start it: {wakeError})</span>}
              </span>
            </span>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span>
                Agent offline — opening this panel should start it; if it stays
                down, try again in a few seconds.
                {wakeError && <span> (couldn't start it: {wakeError})</span>}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={fireWake}
                aria-label="Wake agent"
                className="shrink-0 cursor-pointer"
              >
                Wake agent
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <ScrollArea
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        className="min-h-0 flex-1"
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          {messages.length === 0 && (
            <div className="pt-6 text-center">
              <p className="text-xs text-muted-foreground">
                Ask about your portfolio — the read-only analyst answers from live
                pipeline data.
              </p>
              <div className="mt-3 flex flex-col gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    disabled={busy}
                    className="rounded-md border border-border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50 cursor-pointer"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            if (m.kind === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg rounded-br-sm bg-primary/15 px-3 py-2 text-sm">
                    {m.text}
                  </div>
                </div>
              )
            }
            if (m.kind === 'system') {
              return (
                <div key={i} className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {m.text}
                </div>
              )
            }
            return (
              <div key={i} className="max-w-[92%] rounded-lg rounded-bl-sm bg-secondary/60 px-3 py-2">
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.text || '(no answer)'}</div>
                {m.toolCalls.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.toolCalls.map((tc, j) => (
                      <Badge
                        key={`${j}:${tc.tool}`}
                        variant={tc.status === 'error' ? 'danger' : 'secondary'}
                        className="font-mono text-[10px]"
                      >
                        {tc.tool}
                        <span className="ml-1 text-muted-foreground">{tc.status}</span>
                      </Badge>
                    ))}
                  </div>
                )}
                {!m.withinBudget && (
                  <p className="mt-1.5 text-[10px] text-warning">
                    Answer stopped early (turn/time budget) — it may be incomplete.
                  </p>
                )}
              </div>
            )
          })}

          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Analyst is thinking (read-only tools only)…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <Separator />

      {/* Input */}
      <div className="flex items-end gap-2 p-3">
        <Textarea
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(input)
            }
          }}
          placeholder={hasAgentData ? 'Ask about your portfolio…' : 'Loading portfolio data…'}
          disabled={busy}
          rows={2}
          className="min-h-10 resize-none text-sm"
        />
        <Button
          size="icon"
          onClick={() => void send(input)}
          disabled={busy || input.trim() === ''}
          aria-label="Send question"
          className="cursor-pointer"
        >
          <Send className="size-4" />
        </Button>
      </div>
    </aside>
  )
}