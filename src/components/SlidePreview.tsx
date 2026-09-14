import { groupAlternatingLanguages, orderSlides, type SongBeamerSlide } from '../lib/songbeamer';

type Props = {
  slides: SongBeamerSlide[];
  order: string[];
  langCount: number;
};

export default function SlidePreview({ slides, order, langCount }: Props) {
  const orderedSlides = orderSlides(slides, order);

  return (
    <div className="preview-grid">
      {orderedSlides.length === 0 ? (
        <div className="empty-state preview-empty">Keine Folien für die Vorschau.</div>
      ) : null}
      {orderedSlides.map((slide, index) => (
        <article className="slide-card" key={`${slide.id}-${index}`}>
          <div className="slide-toolbar">
            <span>Folie {index + 1}</span>
            <strong>{slide.label || 'Ohne Versmarkierung'}</strong>
          </div>
          <div className="slide-screen">
            {groupAlternatingLanguages(slide.lines, langCount).map((group, groupIndex) => {
              if (group.length === 1 && group[0] === '') return <div className="preview-spacer" key={groupIndex} />;
              return (
                <div className="translation-group" key={groupIndex}>
                  {group.map((line, languageIndex) => (
                    <div className={`preview-line language-${languageIndex + 1}`} key={`${languageIndex}-${line}`}>
                      {langCount > 1 ? <span className="language-marker" aria-label={`Sprache ${languageIndex + 1}`}>S{languageIndex + 1}</span> : null}
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );
}
