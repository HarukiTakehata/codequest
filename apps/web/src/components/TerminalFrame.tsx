import type { RefObject } from "react";

interface TerminalFrameProps {
  hostRef: RefObject<HTMLDivElement | null>;
  title: string;
}

/** Shared hardware-style chrome; xterm owns the screen and its own theme. */
export function TerminalFrame({ hostRef, title }: TerminalFrameProps) {
  return (
    <div className="terminal-shell-window">
      <div className="terminal-titlebar" aria-hidden="true">
        <span className="terminal-leds"><i /><i /><i /></span>
        <span className="terminal-title">{title}</span>
        <span className="terminal-id">tty0</span>
      </div>
      <div className="xterm-host" ref={hostRef} aria-label={title} />
      <div className="terminal-statusbar" aria-hidden="true">
        <span><i className="terminal-status-light" />TTY / container2wasm</span>
        <span>UTF-8</span>
      </div>
    </div>
  );
}
