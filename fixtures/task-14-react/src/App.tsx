import { useEffect, useState } from "react";
import { usePrism } from "@prism-analytics/react";

const TEST_PROPERTIES = {
  fixture: "task-14-react",
  flow: "hosted-live-proof",
};

export function App() {
  const prism = usePrism();
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [lastAction, setLastAction] = useState("Collection starts denied");

  useEffect(() => {
    const handle = prism.onDiagnostic((diagnostic) => {
      setDiagnostics((current) => [
        `${diagnostic.code}: ${diagnostic.message}`,
        ...current,
      ].slice(0, 4));
    });
    return () => {
      handle.remove();
    };
  }, [prism]);

  const collectionState = prism.collectionState;

  const track = (name: string) => {
    const result = prism.track(name, TEST_PROPERTIES);
    setLastAction(`${name}: ${result.status}`);
  };

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">Task 14 · external React consumer</p>
        <h1>Prism live telemetry fixture</h1>
        <p>
          This app uses packed Core, Browser, and React artifacts. It sends
          only explicit, bounded test events after consent is granted.
        </p>
      </header>

      <section className="status" aria-live="polite">
        <div>
          <span className="label">Collection</span>
          <strong>{collectionState}</strong>
        </div>
        <div>
          <span className="label">Last action</span>
          <strong>{lastAction}</strong>
        </div>
      </section>

      <section className="controls" aria-labelledby="controls-title">
        <h2 id="controls-title">Intentional test controls</h2>
        <div className="button-grid">
          <button type="button" onClick={() => void prism.setCollectionState("granted")}>
            Grant collection
          </button>
          <button type="button" onClick={() => void prism.setCollectionState("denied")}>
            Withdraw collection
          </button>
          <button type="button" onClick={() => track("live_test_loaded")}>
            Send loaded event
          </button>
          <button type="button" onClick={() => track("live_test_cta_clicked")}>
            Send CTA event
          </button>
          <button type="button" onClick={() => {
            void prism.startSession({ properties: TEST_PROPERTIES });
            setLastAction("session started");
          }}>
            Start session
          </button>
          <button type="button" onClick={() => {
            void prism.identify("task-14-test-person", { cohort: "hosted-proof" });
            setLastAction("identified task-14-test-person");
          }}>
            Identify test person
          </button>
          <button type="button" onClick={() => {
            void prism.reset();
            setLastAction("identity reset");
          }}>
            Reset identity
          </button>
          <button type="button" onClick={() => {
            void prism.flush();
            setLastAction("flush requested");
          }}>
            Flush
          </button>
          <button type="button" onClick={() => track("live_test_completed")}>
            Complete live test
          </button>
        </div>
      </section>

      <section className="diagnostics" aria-labelledby="diagnostics-title">
        <h2 id="diagnostics-title">Safe diagnostics</h2>
        {diagnostics.length === 0 ? (
          <p>No diagnostics reported.</p>
        ) : (
          <ul>
            {diagnostics.map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}
          </ul>
        )}
      </section>
    </main>
  );
}
