import { GLOSSARY } from "@/content/glossary";

/** The terms on /results, explained for a reader who is not a statistician. */
export function Glossary() {
  return (
    <div className="flex flex-col gap-6 text-sm">
      {GLOSSARY.map((group) => (
        <section key={group.title}>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{group.title}</h3>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(10rem,14rem)_1fr]">
            {group.entries.map((e) => (
              <div key={e.term} className="contents">
                <dt className="font-medium">{e.term}</dt>
                <dd className="text-muted">{e.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
