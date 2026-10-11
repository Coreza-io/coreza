import React from 'react';
import { useReferenceTextDrop, planReferenceTextDrop, finishReferenceTextDrop } from '@/hooks/useReferenceTextDrop';
import { referenceDropEventHandlers } from './ReferenceDropTarget';

export interface ExpressionFieldEditorProps {
  value: unknown;
  onChange: (value: string) => boolean | void;
  identity: string;
  expectedType?: string;
  disabled?: boolean;
  masked?: boolean;
  multiline?: boolean;
  placeholder?: string;
  preview?: string | null;
  onDrop?: (event: React.DragEvent, value: string) => void;
  makeReference?: (event: React.DragEvent) => string | null;
}
const sourceText = (value: unknown) => value == null ? '' : typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
export function ExpressionFieldEditor({ value, onChange, identity, expectedType, disabled, masked, multiline, placeholder, preview, onDrop, makeReference }: ExpressionFieldEditorProps) {
  const source = sourceText(value);
  const drop = useReferenceTextDrop({ value: source, onChange, disabled, identity });
  const [error, setError] = React.useState<string>();
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault(); event.stopPropagation(); drop.bind(event);
    if (disabled) return;
    if (onDrop) { onDrop(event, source); return; }
    const reference = makeReference?.(event);
    if (!reference) return;
    const insertion = planReferenceTextDrop(event, reference, true, true);
    if (!insertion) { setError('Place the reference in editable text or unquoted expression code. Repair partial delimiters first.'); return; }
    if (onChange(insertion.value) === false) return;
    finishReferenceTextDrop(event, insertion); setError(undefined);
  };
  const common = { ...drop.props, value: source, disabled, placeholder,
    className: 'nodrag w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
    onDrop: handleDrop, onDragEnter: referenceDropEventHandlers.onDragEnter,
    'data-is-reference': source.includes('{{') || undefined,
    'data-expression-contract': '1',
  };
  return <div className="space-y-1 nodrag">
    <div className="flex justify-between text-[10px] text-muted-foreground"><span>Expression</span><span>{expectedType}</span></div>
    {multiline && !masked ? <textarea {...common} ref={drop.controlRef as React.MutableRefObject<HTMLTextAreaElement | null>} />
      : <input {...common} type={masked ? 'password' : 'text'} ref={drop.controlRef as React.MutableRefObject<HTMLInputElement | null>} />}
    {(error || drop.error) && <p role="status" className="text-xs text-destructive">{error || drop.error}</p>}
    {!masked && preview && <p className="text-xs text-muted-foreground break-all">{preview}</p>}
  </div>;
}
