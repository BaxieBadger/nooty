# Ikonpakke — projektnavigation

Lucide-ikoner (https://lucide.dev, ISC-licens), tegnet i 24x24 med stroke-width 2.75,
stroke = currentColor, runde hjørner og linjeender — jf. Organic-designsystemet.

## Filer (ikoner/svg/)
| Fil | Punkt | Lucide-navn |
| --- | --- | --- |
| dashboard.svg | Dashboard | layout-dashboard |
| opgaver.svg | Opgaver | list-checks |
| kalender.svg | Kalender | calendar-days |
| some.svg | SoMe | share-2 |
| kilder.svg | Kilder | users-round |
| afrapportering.svg | Afrapportering | presentation |
| ugerapport.svg | Ugerapport | file-clock |
| avis.svg | Avis | newspaper |
| projekt.svg | Projekt | folder-kanban |
| aktiviteter.svg | Aktiviteter | activity |
| kommunikation.svg | Kommunikation | messages-square |

Alternativer til Kilder (overskriv kilder.svg med den, I foretrækker):
kilder-alt-1-users.svg (users), kilder-alt-2-contact.svg (contact)

## Implementering
Inline SVG anbefales, så farven kan styres i CSS:

    <span class="icon">…svg-indhold…</span>
    .icon svg { width: 20px; height: 20px; }
    .icon { color: var(--color-accent-700); }

Fordi stroke er currentColor, arver ikonet tekstfarven. Skalér frit — 20px i menuer,
24-26px i knapper, 40px+ i tomme tilstande. Ret aldrig stroke-width op eller ned pr.
størrelse; 2.75 er systemets vægt.
