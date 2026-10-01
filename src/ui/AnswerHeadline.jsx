// The answer's headline, with the city it names set in peach (.answer-city). Falls back to the plain
// text when the headline does not name a city.
export default function AnswerHeadline({ text, name }) {
  const at = name ? text.indexOf(name) : -1
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <span className="answer-city">{name}</span>
      {text.slice(at + name.length)}
    </>
  )
}
