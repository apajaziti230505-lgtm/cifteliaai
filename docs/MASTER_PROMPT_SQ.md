# MASTER PROMPT — ÇIFTELIA AI TRANSCRIBER

Sistem profesional për identifikimin automatik të notave nga MP3.

Ky dokument ruan kërkesat e projektit. Statusi real i implementimit dhe kufizimet dokumentohen në README dhe raportin e saktësisë; ekzistenca e këtij dokumenti nuk do të thotë se saktësia është vërtetuar.

## 1. Roli dhe objektivi

Vepro si inxhinier i nivelit të lartë në Digital Signal Processing (DSP), Music Information Retrieval (MIR), Automatic Music Transcription (AMT), Machine Learning / Deep Learning, analizë të sinjaleve polifonike, Python, PyTorch, librosa, SciPy, FastAPI, TypeScript, React dhe Web Audio API.

Ndërto një aplikacion real që analizon MP3 ku dëgjohet vetëm çiftelia dhe identifikon çdo goditje muzikore, notën melodike, telin, perden, goditjet e njëkohshme, kohën e saktë, kohëzgjatjen, tablaturën me dy tela dhe JSON-in përfundimtar.

Prioriteti absolut është saktësia e transkriptimit, jo dizajni grafik. Mos krijo rezultate të simuluara apo nota të rastësishme.

## 2. Struktura reale e çiftelisë

Instrumenti ka dy tela dhe 13 perde. Pozicioni 14 është teli i hapur.

Teli sipër — LART — 220 Hz i hapur. Përdoret kryesisht për shoqërim, zakonisht i hapur bashkë me telin e poshtëm. Rrallë luhet në perde të tjera. Ndonjëherë nuk goditet, por vazhdon të rezonojë. Pohimi “rreth 90%” është njohuri e stilit, jo matje nga dataset-i dhe jo rregull absolut.

Teli poshtë — POSHTË — 293 Hz i hapur. Përdoret kryesisht për melodinë, në perdet 1–13.

| Perdja | Referenca e matur e përdoruesit |
| --- | ---: |
| 14 — Hapur | 293 Hz |
| 1 | 329 Hz |
| 2 | 358 Hz |
| 3 | 389 Hz |
| 4 | 440 Hz |
| 5 | 477 Hz |
| 6 | 521 Hz |
| 7 | 587 Hz |
| 8 | 660 Hz |
| 9 | 719 Hz |
| 10 | 784 Hz |
| 11 | 880 Hz |
| 12 | 960 Hz |
| 13 | 1050 Hz |

Frekuencat e perdeve të sipërme duhet të konfigurohen dhe kalibrohen nga regjistrime reale. Mos shpik frekuenca të matura.

## 3. Parimi kryesor

Teli poshtë = melodia. Teli lart = shoqërimi, zakonisht 220 Hz i hapur. Zakonisht goditen bashkë. Kjo strukturë përdoret si prior probabilistik; mos supozo dy nota në çdo goditje.

Për çdo goditje krahaso: vetëm poshtë; të dy telat me lart të hapur; vetëm lart; lart në perde tjetër bashkë me ose pa poshtë. Zgjidh nga provat akustike.

## 4. Motor hibrid DSP + AI

### A — Përgatitja

Importo MP3/WAV dhe formate të zakonshme, dekodo në PCM, mbaj sample rate të qëndrueshëm, ruaj pozicionet e mostrave dhe kohëzgjatjen. Analizo me STFT dhe CQT. Filtro zhurmën vetëm kur duhet, pa shkatërruar transientët/harmonikat.

### B — Goditjet

Kombino Spectral Flux, Energy Envelope, Transient Detection dhe Multi-resolution Onset Detection. Identifiko goditje të shpejta dhe përsëritje në të njëjtën perde. Llogarit kohën nga indeksi i mostrës, syno gabim sa më të ulët dhe raporto testimin. Mos e quaj çdo rritje energjie goditje të re.

### C — Melodia

Fokuso fillimisht telin poshtë. Përdor harmonic template matching, CQT pitch salience, YIN/pYIN kur është e përshtatshme, multi-pitch estimation dhe vazhdimësinë kohore. Krahaso me frekuencat e kalibruara. Mos përdor vetëm pikun me amplitudën më të lartë.

### D — Teli 220 Hz

Shqyrto energjinë pranë 220 Hz, harmonikat, ndryshimin në onset, transientin, tingullin e mëparshëm dhe zbehjen. Dallo një goditje të re nga rezonanca e goditjes së mëparshme. Prania e frekuencës nuk është provë e goditjes së re.

### E — Harmonikat

220 Hz mund të prodhojë 440, 660, 880, 1100 Hz. Mos i numëro automatikisht si nota dhe mos i fshi automatikisht si harmonika. Përdor template separation, spectral residual analysis dhe transientët. Për 220 + 440 Hz shqyrto si harmonikën e 220 ashtu edhe perden 4 të telit poshtë.

### F — Dy telat

Paired-String Onset Detection duhet të regjistrojë dy nota në një ngjarje kur mbështeten nga audioja. Ruaj kohën e përbashkët dhe kohën individuale kur identifikohet; mos detyro timestamp identik kur ka diferencë reale.

## 5. Kalibrimi

Mundëso regjistrimin e telit 220 Hz, telit 293 Hz, të gjitha perdeve poshtë dhe perdeve të përdorura lart; goditje të lehta/mesatare/të forta; çifte telash dhe melodi të shpejta/të ngadalta. Ndërto profile harmonikash, transientësh dhe zbehjeje nga regjistrime reale. Krahaso baseline DSP me AI; aktivizo AI vetëm me përmirësim të matur.

## 6. Machine Learning

Nëse DSP nuk mjafton, ndërto ose përshtat klasifikim të perdes melodike, reattack 220 Hz, çifteve, përsëritjeve dhe ndryshimeve të rralla lart. Trajno me regjistrime reale dhe etiketa të verifikuara. Ndaj train/validation/test pa regjistrime pothuajse identike në train dhe test. Mos shpik metrika.

## 7. Tablatura automatike

Dy tela, lart 220 Hz dhe poshtë 293 Hz; pozicione sipas kohës reale; perde 1–13 dhe 14 hapur; çifte në të njëjtin event; confidence dhe ngjyra për pasiguri; ndryshim manual, zhvendosje, fshirje/shtim, undo/redo, grupe automatike/manuale dhe luajtje vetëm e grupit. Mos fshi korrigjimet manuale gjatë rianalizimit.

## 8. Sinkronizimi MP3–tablaturë

Mbështet 1.00×, 0.50×, 0.25×. Ruaj timestamp-et sipas audios origjinale. Shpejtësia, zoom-i dhe scroll-i nuk ndryshojnë kohët e ruajtura. Përdor sample indices ose kohë të qëndrueshme; testo seek, pauzë, rifillim dhe grupet.

## 9. JSON

Ruaj të gjitha notat e identifikuara me `id`, `time`, `string`, `fret`, `frequency`, `confidence`, `group`, kohëzgjatjen/fundin, event ID, metadata të audios, versionin e analizës dhe statusin manual. Confidence në shembuj është vetëm demonstrim. Siguro përputhshmërinë me databazën JSON ekzistuese.

## 10. Ndërfaqja

Web modern, i përshtatshëm për mobile. React, TypeScript, Web Audio API, Canvas/SVG dhe waveform interaktiv. Backend Python, FastAPI, NumPy/SciPy, librosa, PyTorch nëse duhet dhe FFmpeg.

Ngarko MP3, analizo gjithë këngën, shfaq rezultate/waveform/spektrogram/tablaturë, luaj në sinkronizim, korrigjo dhe eksporto. Mos përdor dizajn për të fshehur mungesën e analizës reale.

## 11. Matja e saktësisë

Përdor audio testuese me tablaturë të etiketuar manualisht. Mat precision/recall të onset-eve, gabimin kohor në ms, saktësinë e perdes dhe reattack 220 Hz, çiftet, FP/FN, note precision/recall/F1 dhe kalibrimin e confidence. Raporto veçmas regjistrime të lehta, të shpejta dhe të vështira. Objektivi është saktësia, jo përqindje pa prova.

## 12. Dorëzimi

Kod real/funksional, strukturë projekti, motor analize, frontend/backend, instalim, teste automatike, JSON, raport saktësie dhe kufizime. Fillimisht ndërto/testo motorin; më pas tablaturën dhe UI-në.

Qëllimi: ngarko një MP3 ku dëgjohet vetëm çiftelia; analizo të gjithë këngën; identifiko melodinë, verifiko goditjet 220 Hz, dallo harmonikat dhe krijo tablaturë të sinkronizuar, të korrigjueshme dhe të eksportueshme.

Mos supozo dy tela vetëm sepse ndodh shpesh. Përdor stilin si prior; vendimin merre nga tingulli.
