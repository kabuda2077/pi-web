"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from "react";
import { useI18n } from "@/hooks/useI18n";
import { hasTurnRef, isHiddenCustomMessage, splitFinalAssistantBlocks } from "@/lib/message-display";
import type { AgentMessage, AssistantMessage, CustomMessage, UserMessage } from "@/lib/types";
import styles from "./TurnNavigator.module.css";

type ElementRef = RefObject<HTMLDivElement | null>;
interface Props {
  messages: AgentMessage[];
  turnAnchors: readonly boolean[];
  turnsBefore: number;
  visibleCount: number;
  scrollContainer: ElementRef;
  column: ElementRef;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  onRevealHistory: () => void;
  getStreamingMessage: () => Partial<AgentMessage> | null;
}

interface Turn {
  prompt: UserMessage | CustomMessage;
  firstRef: number;
  pastRef: number;
  answer: string;
}

function textPreview(content: unknown): string {
  const text: string = typeof content === "string" ? content : Array.isArray(content)
    ? content.find(b => b?.type === "text" && b.text?.trim())?.text ?? "" : "";
  return text.slice(0, 650).replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/^\s*#{1,6}\s+/gm, "").replace(/\*\*|```/g, "").replace(/\s+/g, " ").trim();
}

function answerOf(message: Partial<AgentMessage> | null) {
  return message?.role === "assistant" ? textPreview(splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks) : "";
}

export const TurnNavigator = memo(function TurnNavigator({ messages, turnAnchors, turnsBefore, visibleCount, scrollContainer, column, messageRefs, onRevealHistory, getStreamingMessage }: Props) {
  const { t } = useI18n();
  const turns = useMemo(() => {
    const result: Turn[] = [];
    let ref = 0;
    for (const [i, message] of messages.entries()) {
      if (turnAnchors[i]) result.push({ prompt: message as Turn["prompt"], firstRef: ref, pastRef: ref, answer: "" });
      if (hasTurnRef(message, turnAnchors[i])) ref++;
      const turn = result.at(-1);
      if (!turn) continue;
      turn.pastRef = ref;
      if (message.role === "assistant") turn.answer = answerOf(message) || turn.answer;
    }
    return result;
  }, [messages, turnAnchors]);
  // A hidden extension anchor has no node. Its first mounted reply locates it.
  const target = useCallback((turn: Turn) => {
    for (let i = turn.firstRef; i < turn.pastRef; i++) {
      const el = messageRefs.current[i];
      if (el) return el;
    }
    return null;
  }, [messageRefs]);
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  const pending = useRef<{ number: number; behavior: ScrollBehavior } | null>(null);
  const pressedTurn = useRef<number | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const scrollTo = useCallback((turn: Turn, behavior: ScrollBehavior) => {
    const el = target(turn), scroller = scrollContainer.current;
    if (!el || !scroller) return false;
    const top = scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
    scroller.scrollTo({ top, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : behavior });
    return true;
  }, [scrollContainer, target]);
  const jump = (index: number, behavior: ScrollBehavior = "smooth") => {
    const number = turnsBefore + index + 1;
    setPreview(number);
    pending.current = null;
    if (!scrollTo(turns[index], behavior)) {
      pending.current = { number, behavior };
      onRevealHistory();
    }
  };

  useEffect(() => {
    const el = scrollContainer.current, body = column.current;
    if (!el || !body || turns.length < 2) return;
    let frame = 0;
    let offsets: { top: number; number: number }[] = [];
    const sync = () => {
      const line = el.scrollTop + 20;
      let lo = 0, hi = offsets.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (offsets[mid].top <= line) lo = mid + 1;
        else hi = mid;
      }
      setActive(offsets[Math.max(0, lo - 1)]?.number ?? turnsBefore + 1);
    };
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const fits = body.getBoundingClientRect().left - rect.left >= 64 && el.clientHeight >= 180;
      setHeight(fits ? el.clientHeight : 0);
      if (!fits) { setPreview(null); return; }
      const origin = rect.top - el.scrollTop;
      offsets = turns.flatMap((turn, i) => {
        const node = target(turn);
        return node ? [{ top: node.getBoundingClientRect().top - origin, number: turnsBefore + i + 1 }] : [];
      });
      const request = pending.current;
      const deferred = request && turns[request.number - turnsBefore - 1];
      if (deferred && scrollTo(deferred, request.behavior)) pending.current = null;
      sync();
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    observer.observe(body);
    schedule();
    el.addEventListener("scroll", sync, { passive: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); el.removeEventListener("scroll", sync); };
  }, [column, scrollContainer, scrollTo, target, turns, turnsBefore, visibleCount]);

  if (!height || turns.length < 2) return null;
  const first = turnsBefore + 1, last = turnsBefore + turns.length;
  const current = Math.max(first, Math.min(last, preview ?? active));
  const index = current - first, turn = turns[index];
  const gap = Math.min(10, (height - 150) / (turns.length - 1));
  const span = (turns.length - 1) * gap;
  const pointerIndex = (e: PointerEvent<HTMLDivElement>) => Math.max(0, Math.min(turns.length - 1, Math.round((e.clientY - e.currentTarget.getBoundingClientRect().top - 10) / gap)));
  const label = t("turnNavigator.turn", { number: current, total: last });
  const answer = preview !== null && index === turns.length - 1 ? answerOf(getStreamingMessage()) || turn.answer : turn.answer;
  return (
    <div className={styles.navigator} style={{ height: span + 20 }} onPointerLeave={e => { if (!track.current?.hasPointerCapture(e.pointerId)) setPreview(null); }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setPreview(null); }}>
      <div className={styles.track} ref={track} role="slider" data-turn-navigator="" tabIndex={0} aria-orientation="vertical" aria-label={t("turnNavigator.label")} aria-valuemin={first} aria-valuemax={last} aria-valuenow={current} aria-valuetext={label}
        onFocus={() => setPreview(current)}
        onPointerMove={e => {
          const i = pointerIndex(e), number = first + i;
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) setPreview(number);
          else if (pressedTurn.current !== number) {
            pressedTurn.current = number;
            jump(i, "instant");
          }
        }}
        onPointerEnter={e => setPreview(first + pointerIndex(e))}
        onPointerDown={e => {
          if (e.button !== 0) return;
          const i = pointerIndex(e);
          pressedTurn.current = first + i;
          e.currentTarget.focus({ preventScroll: true });
          e.currentTarget.setPointerCapture(e.pointerId);
          jump(i);
        }}
        onLostPointerCapture={() => { pressedTurn.current = null; }}
        onPointerCancel={() => setPreview(null)}
        onKeyDown={e => {
          const next = ({ ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: turns.length - 1 } as Record<string, number>)[e.key];
          if (next !== undefined) { e.preventDefault(); jump(Math.max(0, Math.min(turns.length - 1, next))); }
          else if (e.key === "Escape" && preview !== null) { e.stopPropagation(); setPreview(null); }
        }}>
        {turns.map((_, i) => <span key={first + i} className={styles.tick} data-distance={preview === null ? undefined : Math.min(3, Math.abs(index - i))} data-current={active === first + i || undefined} style={{ top: 10 + i * gap }} />)}
      </div>
      {preview !== null && <button type="button" data-turn-preview="" className={styles.card} style={{ top: 10 + index * gap }} onClick={() => jump(index)}>
        <strong>{isHiddenCustomMessage(turn.prompt) ? t("chatMinimap.extensionTurn", { type: (turn.prompt as CustomMessage).customType }) : textPreview(turn.prompt.content) || t("chat.previewImage")}</strong>
        {answer && <span>{answer}</span>}
        <small>{label}</small>
      </button>}
    </div>
  );
});
