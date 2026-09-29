// The site's "now". Production: the real clock. Dev: ?at=2026-09-28T03:00Z pretends it is that moment
// everywhere at once (weather rows, city skies, the city and ending type), so stills stay consistent.
const AT = import.meta.env?.DEV ? new URLSearchParams(location.search).get('at') : null

export const now = () => (AT ? new Date(AT) : new Date())
