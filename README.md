# Çiftelia AI Transcriber · v3

Transkriptim **real DSP nga PCM**, për çifteli me dy tela dhe 13 perde. Referencat: lart 220 Hz; poshtë 293, 329, 358, 389, 440, 477, 521, 587, 660, 719, 784, 880, 960, 1050 Hz. Në formatin e ri, **hapur = 14 në të dy telat**.

**Ky është një baseline funksional, jo një sistem me saktësi profesionale të vërtetuar.** Akordimi, harmonikat që mbivendosen dhe rezonanca mund të shkaktojnë nota të gabuara ose të humbura. Shih [raportin e saktësisë](reports/ACCURACY_SQ.md). Confidence është heuristik dhe i pakalibruar; nuk është përqindje saktësie. Nuk ka model AI të trajnuar dhe nuk gjenerohen nota të rastësishme.

## Përdorimi

[Hap aplikacionin web](https://apajaziti230505-lgtm.github.io/cifteliaai/).

1. Ngarko MP3/WAV/M4A/FLAC ose format tjetër që dekodohet në pajisjen tënde.
2. Zgjidh **Në këtë pajisje · DSP** dhe **Analizo këngën**. Audioja nuk dërgohet në server në këtë mënyrë.
3. Kontrollo notat me pikë dhe paralajmërimet për akordimin.
4. Kalibro nga regjistrime të izoluara të instrumentit tënd; rianalizo.
5. Korrigjo telin, perden, kohën, zgjatjen dhe grupin. Aktivizo **Lëviz nota** për zvarritje. Me këtë opsion të fikur, rrëshqitja e tablaturës ruan pozicionet.
6. Luaj në 1×, 0.5× ose 0.25×; eksporto JSON v3 ose JSON për databazën e vjetër.

MP3-ja e re hap tablaturë të pastër. JSON mund të importohet edhe pa audio; më pas përdor **Lidh MP3 me këtë këngë**. Këngët, MP3-të, profilet dhe korrigjimet ruhen në IndexedDB në këtë shfletues. Eksporto JSON për kopje të punës. Skedari origjinal audio mbetet veçmas nga eksporti JSON.

## Motori Python me STFT dhe CQT

Kërkon Python 3.11–3.13, FFmpeg ose imageio-ffmpeg. `ffprobe` shton metadata kur është i instaluar. React/TypeScript është i ndërtuar në `studio/`; Node nuk nevojitet për nisjen normale.

Në Windows: hap `Start_Windows.bat`. Në Linux/macOS:

```bash
bash Start_Linux_Mac.sh
```

Ose instalo manualisht:

```bash
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
python -m transcriber.api
```

Hap <http://127.0.0.1:8765>, zgjidh **Server Python · STFT + CQT**, dhe lëre adresën bosh. Dokumentacioni i API-së: <http://127.0.0.1:8765/docs>.

Me Docker:

```bash
docker compose up --build
```

GitHub Pages shërben frontend-in dhe motorin JavaScript; nuk ekzekuton Python. Për Python në telefon duhet një server HTTPS i arritshëm dhe origjina e frontend-it në `CIFTELIA_ALLOWED_ORIGINS`. `127.0.0.1` në telefon është vetë telefoni. Docker lidhet në localhost si parazgjedhje. Ky projekt nuk instalon automatikisht një shërbim publik Python.

## Si analizon

- PCM mono me sample rate të qëndrueshëm; backend-i përdor 22050 Hz dhe FFmpeg. Nuk aktivizohet filtrimi i zhurmës si parazgjedhje.
- Spectral flux, transientë energjie, analiza e fazës dhe dy rezolucione STFT në Python.
- CQT me 24 bins/octave në Python si provë ndihmëse. Frontend-i ka baseline të veçantë FFT/harmonic residual; nuk pretendohet barazi numerike mes motorëve.
- Hipoteza vetëm poshtë, vetëm lart, dy tela dhe perde të sipërme të kalibruara, me përshtatje të përbashkët të profileve harmonike.
- Krahasimi para/pas goditjes dhe i fazës pakëson ngatërrimin e rezonancës me goditjen e re. Prania e vazhduar në 220 Hz nuk shton automatikisht një notë.
- Prior i dobët i stilit; nuk shtohet automatikisht teli lart. 440/660/880 Hz mund të jenë harmonika ose nota reale; paqartësitë shënohen për kontroll.
- Kalibrimi mat frekuencën me YIN, harmonikat dhe zbehjen nga një tel i izoluar. Perdet e sipërme nuk shpiken nga raporti 220/293.
- Event ID dhe kohë e përbashkët me vlerësime individuale për telat. Indeksi i mostrës është rezolucioni i ruajtjes, **jo provë e gabimit fizik prej një mostre**.
- Zgjatja nga zbehja dhe goditja pasuese në të njëjtin tel; fundi akustik mbetet i pasigurt.
- Kandidatët pa prova të mjaftueshme ruhen në `analysis.unresolved`; nuk kthehen në nota të hapura të shpikura.

Luajtja në frontend përdor WAV PCM nga e njëjta audio si analiza lokale. Kohët ruhen në audio origjinale pavarësisht shpejtësisë, zoom-it dhe lëvizjes horizontale. FFmpeg dhe Web Audio mund të dekodojnë ndryshe disa formate; sinkronizimi nuk është certifikuar në çdo pajisje iOS/Android.

## JSON dhe databaza ekzistuese

V3 ruan `id`, `event_id`, `event_time`, `sample_index`, `time` në sekonda, `end_sample`, `end_time`, `duration`, `string: upper/lower`, `fret: 1..14`, `frequency`, `confidence`, `confidence_status`, `group`, `manual`, `source` dhe prova akustike.

Projekti ruan `audio`, `analysis.version`, `profile`, `groups`, `tombstones` dhe waveform/spektrogram. Fshirjet manuale dhe ankorat e notave të lëvizura mbrohen gjatë rianalizimit. Undo/redo përfshin notat, grupet dhe fshirjet.

Adapteri i **databazës ekzistuese** është i veçantë dhe i testuar: `time` në ms, `string:1` poshtë, `string:2` lart; `noteNumber:15` = poshtë i hapur, `noteNumber:14` = lart i hapur. Eksporti i vjetër ruan këtë numërim. `withF` zbërthehet vetëm si etiketë e importuar; motori nuk e përdor si provë goditjeje.

## Zhvillimi dhe testet

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
npm ci --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
node --test web/tests/*.test.cjs
```

Frontend në zhvillim: `npm --prefix frontend run dev`; Vite përcjell `/api` në FastAPI 8765. Përditëso `studio/` me build para GitHub Pages.

Tingujt sintetikë përdoren **vetëm në teste të kodit**, jo si këngë ose rezultate të përdoruesit. Analiza e MP3-së reale dhe krahasimi provizor me JSON-in e mëparshëm nuk zëvendësojnë dataset-in e verifikuar.

## Matja dhe AI

Shih [procedurën e vlerësimit](docs/EVALUATION_SQ.md). Përputhja një-me-një raporton precision/recall/F1, gabimin kohor, perdet, goditjet 220 Hz, çiftet dhe kalibrimin e confidence. Ndarja train/validation/test izolon sesionet. Model ML nuk aktivizohet pa regjistrime reale të etiketuara dhe përmirësim të matur kundrejt DSP.

## Struktura

```text
transcriber/     Python: audio, schema, engine, calibration, evaluation, FastAPI
frontend/src/    React/TypeScript, DSP worker, PCM transport, storage, tablature
frontend/tests/  DSP browser, timeline, JSON adapters, PCM playback
studio/          Frontend i ndërtuar për GitHub Pages dhe FastAPI
tests/           Motor DSP, API dhe regresionet e studios së mëparshme
scripts/         Ndarja e dataset-it sipas sesionit
reports/         Raporti i saktësisë dhe krahasimi provizor i audios reale
docs/            Kërkesa master dhe protokolli i vlerësimit
legacy.html      Studioja e mëparshme e videos
```

Kufijtë aktualë: 256 MB/30 minuta; një analizë Python njëkohësisht; kalibrim nga nota të izoluara, jo ndarje automatike e mostrës polifonike; dataset train/validation/test ende i paverifikuar; pa model të trajnuar; confidence i pakalibruar; rishikim i nevojshëm për akordime të ndryshme dhe harmonika të mbivendosura.
