import { groupAlternatingLanguages, type SonBeamerSlide } from '../lib/sonbeamer';

type Props = {
  slides: SonBeamerSlide[];
  order: string[];
  langCount: number;
};

export default function SlidePreview({ slides, order, langCount }: Props) {
  const byLabel = new Map(slides.map((slide) => [slide.label, slide]));
  const orderedSlides = order.length
    ? order.map((label) => byLabel.get(label)).filter((slide): slide is SonBeamerSlide => Boolean(slide))
    : slides;

  return (
    <div className="preview-grid">
      {orderedSlides.length === 0 ? (
        <div className="empty-state preview-empty">No slides to preview.</div>
      ) : null}
      {orderedSlides.map((slide, index) => (
        <article className="slide-card" key={`${slide.id}-${index}`}>
          <div className="slide-toolbar">
            <span>Slide {index + 1}</span>
            <strong>{slide.label}</strong>
          </div>
          <div className="slide-screen">
            {groupAlternatingLanguages(slide.lines, langCount).map((group, groupIndex) => {
              if (group.length === 1 && group[0] === '') return <div className="preview-spacer" key={groupIndex} />;
              return (
                <div className="translation-group" key={groupIndex}>
                  {group.map((line, languageIndex) => (
                    <div className={`preview-line language-${languageIndex + 1}`} key={`${languageIndex}-${line}`}>
                      {langCount > 1 ? <span className="language-marker">L{languageIndex + 1}</span> : null}
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
