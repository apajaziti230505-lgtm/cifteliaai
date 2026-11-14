# Çiftelia Studio AI — aplikacion lokal për audio, video dhe tablaturë

Program për **Windows, Linux ose macOS**, i shkruar në Python me ndërfaqe që hapet në shfletues. Punon në kompjuterin tënd pa abonime. Interneti duhet vetëm në instalimin e parë të bibliotekave Python.

## Nisja në Windows

1. Shpaketo të gjithë arkivin RAR në një dosje (p.sh. Desktop / Ciftelia_Studio_AI). Mos e nis programin direkt brenda arkivit.
2. Instalo **Python 3.11, 3.12 ose 3.13**, nëse nuk e ke. Gjatë instalimit shëno **Add Python to PATH**.
3. Kliko dy herë mbi **Start_Windows.bat**.
4. Herën e parë, prit sa të instalohen bibliotekat falas. Herët pasuese nisja punon edhe pa internet.
5. Hapet automatikisht faqja lokale **http://127.0.0.1:8765**. Nëse nuk hapet, shkruaje adresën në Chrome/Edge.
6. Mos e mbyll dritaren e zezë derisa po përdor programin.

Në Linux/macOS përdor terminalin: `bash Start_Linux_Mac.sh`.

### Çfarë përfshin

- Import video **MP4, MOV, MKV, WEBM**, ose audio **MP3/WAV** (deri në 500 MB).
- Lexim i frekuencave të tingullit me analizë spektrale dhe zbulim i fillimit të goditjeve.
- Hartë e kalibruar për **2 tela: lart 220 Hz, poshtë 293 Hz**, 13 perde + teli i hapur (0). Frekuencat e poshtme janë ato të matura prej teje, jo frekuenca standarde kitare.
- Ndjekje e lëvizjes në video për të **vlerësuar** poshtë/lart, duke përdorur OpenCV dhe optical flow.
- Zbulim **eksperimental** i lëvizjeve të heshtura (plektrumi kalon pa prekur telin).
- Tablaturë me 3 rreshta: teli poshtë, teli lart dhe lëvizje pa notë.
- **Shto / ndrysho / fshi / zhvendos** nota në kohë me 0.001 sekonda. Zhbëj / ribëj (Undo / Redo).
- **3 shpejtësi: 1.00×, 0.50×, 0.25×.**
- Grupe nga pauzat, dëgjim i një grupi, shtim i grupeve, import / eksport JSON.
- Ruajtje automatike në dosjen `data/projects/`.

## Analizë hap pas hapi

1. Ngarko videon. Për një video MOV ose HEVC që nuk luhet nga shfletuesi, shtyp **Konverto** (krijon MP4 për shfaqje pa ndryshuar origjinalin).
2. Ndalo videon kur dora e djathtë dhe plektrumi duken qartë.
3. Kliko **Përzgjidh zonën e plektrumit** dhe vizato drejtkëndëshin rreth **dorës së djathtë dhe telave**, duke përfshirë lëvizjen, por jo gjithë instrumentin.
4. Zgjidh boshtin (vertikal/horizontal). Kjo varet nga orientimi i kamerës. Nëse drejtimet dalin të kundërta, aktivizo **Kthe drejtimet** dhe analizo sërish.
5. Kliko **Analizo audio + video**. Nëse nuk ke shënuar zonën, programi analizon vetëm audion dhe lë drejtimin e goditjeve si `?`.
6. Shtyp një notë në vijën kohore për ta korrigjuar. Ndrysho sekondën, telin, perden (0–13), goditjen (↓, ↑, pa prekje), grupin dhe zgjatjen.
7. Dy klikime mbi rreshtin përkatës në tablaturë shtojnë një notë në atë sekondë. Mund edhe të shtypësh **Shto notë** te pozicioni aktual i videos. Zvarrite notën majtas/djathtas për ta ripozicionuar.
8. Eksporto **JSON** për ta ruajtur ose për integrim me aplikacionin tjetër të çiftelisë.

## Kufizime reale të saktësisë

**Ky është një version funksional me heuristika të analizës audio/video, jo një model AI i trajnuar dhe i certifikuar me saktësi 80%.** Nuk ka bazë reale të pretendojmë mbi 80% për të gjitha videot. Video të mjegullta, kamera që lëviz, duar që mbulojnë telat dhe muzikë në sfond e ulin saktësinë. Audioja nuk mund të tregojë nëse plektrumi lëvizi pa prekur telin. Për këtë programi përdor vetëm sinjale nga videoja dhe i shënon si ngjarje **për kontroll**. Edhe zbulimi i drejtimit poshtë/lart është vlerësim, sepse lëvizja e ekranit nuk përputhet gjithnjë me goditjen reale.

Programi nuk i lexon me siguri të gjitha notat kur **të dy telat tingëllojnë njëkohësisht**. Ai mund të shënojë gabimisht harmoni të një teli si notë të telit tjetër; korrigjoji. Më e rëndësishmja: rezultatet automatike **nuk e zëvendësojnë kontrollin me vesh**.

Për të matur saktësinë reale 80% kërkohen regjistrime të etiketuara manualisht nga disa këngë e muzikantë dhe testim i ndarë i: notës, drejtimit dhe lëvizjes së heshtur. Ky arkiv përfshin testet automatike të algoritmit, por **jo** një model të trajnuar mbi një dataset të tillë.

## Siguria dhe privatësia

Serveri lokal dëgjon vetëm në `127.0.0.1`. Nuk dërgon video apo nota në server të jashtëm. Skedarët ruhen në `data/media`, projektet në `data/projects`. Mos e fshi `data/` nëse dëshiron të mbash punën tënde. Eksporto JSON si kopje rezervë.

## Ruajtja e kohës

Të gjitha kohët mbahen në **sekonda të videos origjinale**, jo në sekonda të shpejtësisë 0.25×. Ndryshimi i shpejtësisë së luajtjes nuk ndryshon kohët e notave. Kur korrigjon në 0.25×, sekonda në tablaturë mbetet pozicioni origjinal i medias.

## Hotkeys

- `Space`: luaj / ndalo (kur nuk po ndryshon një fushë).
- `Delete`: fshi notën e zgjedhur.
- `Ctrl+Z`: zhbëj; `Ctrl+Shift+Z`: ribëj.

## Për zhvillues

`server.py` — server lokal HTTP standard (pa Flask); `analyzer.py` — përpunimi i audios, spektri, optical flow; `static/` — ndërfaqja HTML/JS/CSS; `tests/` — provat e algoritmit.

Testet: `python -m pytest tests -q` (pytest opsional, jo i nevojshëm për përdorim normal).

Skema JSON: `events: [{id,time,duration,string,fret,stroke,group,confidence,review,source}]`. `string` = `poshte`, `lart` ose `ghost`; `fret` = 0–13 (0 = tel i hapur), `stroke` = `down`, `up`, `unknown`, `ghost_up`, `ghost_down`. Në import lejohen edhe `notes` dhe disa fusha alternative. Ky JSON mund të ketë nevojë për përshtatje me skemën e saktë të një aplikacioni tjetër.

**Licencë aplikacioni:** mund ta modifikosh kodin Python/JS për përdorimin tënd. Bibliotekat e treta janë nën licencat e tyre. FFmpeg i përfshirë nga `imageio-ffmpeg` ka kushte licencimi sipas ndërtimit përkatës.