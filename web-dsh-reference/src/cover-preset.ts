/** Original Knot artwork; distributed under the repository's license, not a downloaded image. */
export const coverPreset = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400">
  <defs>
    <linearGradient id="sky" x2="1" y2="1"><stop stop-color="#18233d"/><stop offset=".6" stop-color="#394a75"/><stop offset="1" stop-color="#8b668d"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="#ddc8ee" stop-opacity=".6"/><stop offset="1" stop-color="#ddc8ee" stop-opacity="0"/></radialGradient>
  </defs>
  <path fill="url(#sky)" d="M0 0h1200v400H0z"/>
  <ellipse cx="910" cy="135" rx="300" ry="240" fill="url(#glow)"/>
  <g fill="none" stroke="#bdc9eb" stroke-width="3" opacity=".65">
    <path d="M-40 330C150 330 175 110 350 155S520 355 710 190 940 90 1240 160"/>
    <path d="M-40 350C150 350 175 130 350 175S520 375 710 210 940 110 1240 180"/>
    <circle cx="350" cy="164" r="18"/><circle cx="710" cy="200" r="18"/><circle cx="960" cy="131" r="18"/>
  </g>
</svg>`)
