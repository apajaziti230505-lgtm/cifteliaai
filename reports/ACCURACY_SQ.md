# Raporti i saktësisë · 15 nëntor 2026

**Status: baseline DSP funksional; saktësia profesionale nuk është arritur ose vërtetuar.** Nuk është trajnuar ose aktivizuar model AI. Confidence është heuristik, i pakalibruar dhe nuk barazohet me saktësinë.

## Verifikimi i kodit

- 29 teste Python kaluan: audio, goditje të përsëritura 60 ms larg, harmonika, reattack kundrejt rezonancës, çifte 220+440 Hz, goditje telash me 12 ms diferencë, frekuenca melodike, kalibrim real i PCM-së, JSON/databaza ekzistuese, korrigjime/fshirje, matja një-me-një, ndarja e sesioneve, API dhe punë të ndërprera.
- 21 teste TypeScript/Node kaluan: DSP browser, e njëjta seri e rasteve kritike, numërimi i databazës së vjetër, ruajtja e grupeve/identitetit, invarianca ndaj zoom/pan/shpejtësi/seek dhe WAV PCM me numër të saktë mostrash.
- 1 regresion i gjurmimit të videos së mëparshme kaloi.
- TypeScript dhe build Vite kaluan; `git diff --check` kaloi.

Tingujt sintetikë janë fixture të testimit. **51 teste të kaluara nuk do të thonë 51 regjistrime reale të transkriptuara saktë.** Testi i transportit kontrollon koordinatat dhe PCM-në; ndërveprimet në çdo iPhone/Android nuk janë certifikuar. Kontrolli vizual me preview nuk u krye sepse shërbimi i preview nuk u nis në këtë mjedis. Kontejneri Docker është përgatitur, por nuk është ndërtuar/testuar këtu.

## Kontrolli provizor i një audioje reale

U analizua i gjithë MP3-ja “Shtat shaljan kane ra në Shtoj-0.mp3”, 80.137 s. Krahasimi përdor JSON-in e mëparshëm `shtat.json`: 400 rreshta të vjetër bëhen 797 nota pasi zbërthehen shënimet `withF`.

**Etiketat, kohët dhe `withF` nuk janë verifikuar në mënyrë të pavarur ndaj kësaj audioje.** Prandaj tabela është kontroll përputhjeje me referencën e importuar, jo vlerësim i vlefshëm i saktësisë reale. Toleranca e përputhjes është ±50 ms dhe çiftimi është një-me-një; gabimi kohor raportohet vetëm për onset-et e përputhura.

| Motori | Nota të parashikuara | Note precision | Note recall | Note F1 | Onset F1 | Gabimi mesatar absolut |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Python STFT + CQT | 156 | 10.90% | 2.13% | 3.57% | 29.14% | 27.53 ms |
| Browser DSP | 179 | 8.94% | 2.01% | 3.28% | 30.05% | 25.90 ms |

Rezultati i ulët është arsye për kalibrim dhe kontroll manual, jo për ta reklamuar motorin si të saktë. Në audio u gjet një familje harmonikash e qëndrueshme afërsisht 247 Hz, larg referencës 220 Hz. Kjo është **inferencë diagnostikuese, jo frekuencë e kalibruar e telit**. Sistemi nuk ndryshon vetë profilin dhe i shënon rezultatet për rishikim. Pa prova nuk mund t'i atribuohen të gjitha gabimet vetëm akordimit ose etiketave.

Raportet numerike përfshijnë veçmas telat, goditjet e reja 220 Hz, çiftet, FP/FN, gabimin median/p95 dhe ECE/Brier:

- [Python: real_audio_alignment.json](real_audio_alignment.json)
- [Browser: real_browser_alignment.json](real_browser_alignment.json)

## Çfarë ende nuk është matur

Nuk ka test set të verifikuar të pavarur, as rezultate të veçanta të vërtetuara për regjistrime të lehta, të shpejta dhe të vështira. Nuk ka rezultat train/validation/test të një modeli ML. Saktësia e fundeve/kohëzgjatjeve dhe kalibrimi probabilistik i confidence nuk janë vërtetuar. Perdet e rralla lart kërkojnë regjistrim të izoluar; frekuencat e tyre nuk shpiken.

Kufiri minimal i ndarjes së onset-eve në baseline është rreth 28 ms. Çifte të paqarta, akordime të ndryshme, zhurma, MP3 shumë i kompresuar dhe harmonika që mbivendosen mund të japin gabime. Prania e 220 Hz vetëm nuk provon goditje të re; mungesa e provave mund të lërë onset-e te `analysis.unresolved`.

Hapi i nevojshëm për saktësi më të lartë është mbledhja e mostrave të instrumentit, etiketimi i kontrolluar dhe testimi me sesione të mbajtura veç, sipas [protokollit të vlerësimit](../docs/EVALUATION_SQ.md). Vetëm pastaj mund të matet përmirësimi nga AI dhe të kalibrohet confidence.
