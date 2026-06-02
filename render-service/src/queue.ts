// Single-slot mutex serializing CPU-bound renders.
// Prevents OOM on 16GB host when n8n triggers parallel calls.
let chain: Promise<unknown> = Promise.resolve();

export const serialize = <T>(task: () => Promise<T>): Promise<T> => {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
};
