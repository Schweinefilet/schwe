import { CITIES } from '../config.js'

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
// How many cities the site reads, in words ("ten"), for the copy that names the count.
export const COUNT = WORDS[CITIES.length] ?? String(CITIES.length)

// The ending's answer (content/rainChoice.js) in words, for the final screen and the still page:
// [headline, meta, rate]. The headline names the city and says what the answer is measured against
// (these cities, not the world); the meta line is its local time and weather, like a drop's label; the
// rate is kept apart so its unit is not set in capitals with the meta.
export function answerLines(rain, city, time, clips) {
  if (!rain) return ['', null, null]
  if (rain.kind === 'now' && city) {
    const rate = rain.mmPerHour > 0 ? `${rain.mmPerHour < 1 ? rain.mmPerHour.toFixed(1) : Math.round(rain.mmPerHour)} mm/h` : null
    const headline = rain.of === 1 ? `of the ${COUNT} cities, only ${city.name} has rain right now` : `of the ${COUNT} cities, it’s raining hardest in ${city.name}`
    return [headline, [time, rain.label].filter(Boolean).join(' · '), rate]
  }
  if (rain.kind === 'soon' && city) {
    const weather = clips?.find((c) => c.city === city.id)?.weatherLabel
    return [arrival(city.name, rain.minutes), [`${time} in ${city.name}`, weather].filter(Boolean).join(' · '), null]
  }
  if (rain.kind === 'none') return [`dry in all ${COUNT} cities`, 'no rain due in the next six hours', null]
  return ['the weather couldn’t be read just now', `so there is no answer for the ${COUNT} cities this time`, null]
}

function arrival(name, minutes) {
  if (minutes < 10) return `rain is about to reach ${name}`
  if (minutes < 60) return `rain reaches ${name} in about ${Math.round(minutes / 5) * 5} min`
  const hours = Math.round(minutes / 30) / 2
  return `rain reaches ${name} in about ${hours} ${hours === 1 ? 'hour' : 'hours'}`
}
