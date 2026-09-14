type Props = {
  order: string[];
  labels: string[];
  onChange: (order: string[]) => void;
};

export default function VerseOrderEditor({ order, labels, onChange }: Props) {
  function update(index: number, value: string) {
    const next = [...order];
    next[index] = value;
    onChange(next);
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function remove(index: number) {
    onChange(order.filter((_, itemIndex) => itemIndex !== index));
  }

  function add() {
    onChange([...order, labels[0] ?? '']);
  }

  return (
    <div className="verse-order-editor">
      <div className="order-list">
        {order.length === 0 ? (
          <div className="empty-inline">No verse order. Slides preview in file order.</div>
        ) : null}
        {order.map((item, index) => (
          <div className="order-row" key={`${index}-${item}`}>
            <span className="order-number">{index + 1}</span>
            <input
              value={item}
              onChange={(event) => update(index, event.target.value)}
              list="slide-labels"
              aria-label={`Verse order item ${index + 1}`}
            />
            <button type="button" className="icon-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up">↑</button>
            <button type="button" className="icon-button" onClick={() => move(index, 1)} disabled={index === order.length - 1} aria-label="Move down">↓</button>
            <button type="button" className="icon-button danger" onClick={() => remove(index)} aria-label="Remove">×</button>
          </div>
        ))}
      </div>
      <datalist id="slide-labels">
        {labels.map((label) => <option value={label} key={label} />)}
      </datalist>
      <button type="button" className="secondary small" onClick={add}>+ Add item</button>
    </div>
  );
}
