"use client";

import { useState, useTransition } from "react";
import type { Expression } from "@/lib/data/expressions";
import { LANG_NAMES, MEANING_LANGUAGE_CODES } from "@/lib/constants/languages";
import { updateExpressionAction } from "@/lib/actions/expressionActions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InlineError } from "@/components/admin/InlineError";

export function ExpressionEditPanel({
  expression,
  language,
  onClose,
  onSaved,
}: {
  expression: Expression;
  language: string;
  onClose: () => void;
  onSaved: (updated: Expression) => void;
}) {
  const [text, setText] = useState(expression.text);
  const [register, setRegister] = useState(expression.register);
  const [similarExpressions, setSimilarExpressions] = useState(expression.similarExpressions.join(", "));
  const [meanings, setMeanings] = useState(expression.meanings);
  const [activeTab, setActiveTab] = useState(MEANING_LANGUAGE_CODES[0]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateMeaning(code: string, field: "definition" | "sentence" | "translation", value: string) {
    setMeanings((prev) => {
      const current = prev[code] ?? { definition: "", example: { sentence: "", translation: "" } };
      if (field === "definition") {
        return { ...prev, [code]: { ...current, definition: value } };
      }
      return { ...prev, [code]: { ...current, example: { ...current.example, [field]: value } } };
    });
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const updates = {
        text,
        register,
        meanings,
        similarExpressions: similarExpressions
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const result = await updateExpressionAction(language, expression.id, updates);
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved({ ...expression, ...updates });
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto bg-background p-6 shadow-xl">
        <h2 className="text-lg font-semibold">표현 수정</h2>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            표현 원형
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            register
            <select
              value={register}
              onChange={(e) => setRegister(e.target.value as Expression["register"])}
              className="w-fit rounded-md border border-input bg-background px-3 py-1.5"
            >
              <option value="casual">casual</option>
              <option value="formal">formal</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            비슷한 표현 (콤마로 구분)
            <input
              type="text"
              value={similarExpressions}
              onChange={(e) => setSimilarExpressions(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5"
            />
          </label>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as string)}>
          <TabsList className="flex-wrap">
            {MEANING_LANGUAGE_CODES.map((code) => (
              <TabsTrigger key={code} value={code}>
                {LANG_NAMES[code] ?? code}
              </TabsTrigger>
            ))}
          </TabsList>
          {MEANING_LANGUAGE_CODES.map((code) => {
            const meaning = meanings[code] ?? { definition: "", example: { sentence: "", translation: "" } };
            return (
              <TabsContent key={code} value={code}>
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    definition
                    <textarea
                      value={meaning.definition}
                      onChange={(e) => updateMeaning(code, "definition", e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-1.5"
                      rows={2}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    example.sentence
                    <textarea
                      value={meaning.example.sentence}
                      onChange={(e) => updateMeaning(code, "sentence", e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-1.5"
                      rows={2}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    example.translation
                    <textarea
                      value={meaning.example.translation}
                      onChange={(e) => updateMeaning(code, "translation", e.target.value)}
                      className="rounded-md border border-input bg-background px-3 py-1.5"
                      rows={2}
                    />
                  </label>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>

        {error && <InlineError message={error} />}

        <div className="mt-auto flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            취소
          </Button>
          <Button type="button" onClick={handleSave} disabled={isPending}>
            {isPending ? "저장 중..." : "저장"}
          </Button>
        </div>
      </div>
    </div>
  );
}
