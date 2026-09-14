type Props = {
  order: string[];
  labels: string[];
  onChange: (order: string[]) => void;
};

export default function VerseOrderEditor({ order, labels, onChange }: Props) {
  const choices = [...new Set(labels)].filter(Boolean);
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
    if (choices.length) onChange([...order, choices[0]]);
  }

  return (
    <div className="verse-order-editor">
      <div className="order-list">
        {order.length === 0 ? (
          <div className="empty-inline">Keine Versreihenfolge festgelegt. Die Vorschau folgt der Reihenfolge in der Datei.</div>
        ) : null}
        {order.map((item, index) => (
          <div className="order-row" key={`${index}-${item}`}>
            <span className="order-number">{index + 1}</span>
            <select
              value={item}
              onChange={(event) => update(index, event.target.value)}
              aria-label={`Vers ${index + 1} in der Reihenfolge`}
            >
              {!choices.includes(item) ? <option value={item} disabled>{item || 'Ohne Markierung'} (fehlt)</option> : null}
              {choices.map((label) => <option value={label} key={label}>{label}</option>)}
            </select>
            <button type="button" className="icon-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Nach oben">↑</button>
            <button type="button" className="icon-button" onClick={() => move(index, 1)} disabled={index === order.length - 1} aria-label="Nach unten">↓</button>
            <button type="button" className="icon-button danger" onClick={() => remove(index)} aria-label="Entfernen">×</button>
          </div>
        ))}
      </div>
      <button type="button" className="secondary small" onClick={add} disabled={!choices.length}>+ Vers hinzufügen</button>
    </div>
  );
}
