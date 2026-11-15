# Vlerësimi i riprodhueshëm

Kalimi i testeve të kodit nuk provon saktësinë muzikore. Për matje të besueshme duhen audio dhe etiketa të kontrolluara kundrejt të njëjtit regjistrim.

## Mbledhja

Regjistro telat veçmas, perdet e përdorura, goditje të lehta/mesatare/të forta, dy tela njëkohësisht, raste ku 220 Hz vetëm rezonon dhe melodi të ngadalta/të shpejta. Mostrat e izoluara shërbejnë për kalibrimin e toneve; çiftet dhe meloditë për vlerësim të etiketuar. Ky version ende nuk mëson profil timbrik të veçantë nga një mostër polifonike.

Eksporto JSON v3 pas kontrollit manual. Verifiko çdo tel/goditje me dëgjim, spektrogram dhe video kur ka. Mos vendos `annotations_verified: true` për etiketa automatike të pakontrolluara.

Manifesti privat, me rrugë relative:

```json
{
  "annotations_verified": false,
  "recordings": [
    {
      "id": "session-a-take-1",
      "session_id": "performer-a-instrument-a-day-a",
      "leakage_group": "performer-a-instrument-a-day-a",
      "category": "slow",
      "audio": "audio/take-1.wav",
      "labels": "labels/take-1.json"
    }
  ]
}
```

Shto `profile` me profilin e instrumentit. Kalibroje nga train, kontrolloje në validation; mos nxirr template nga test. Take pothuajse identike, kopje të kompresuara, i njëjti fragment dhe variante shpejtësie qëndrojnë në të njëjtin `leakage_group`. Bashko grupet kur disa sesione përmbajnë të njëjtën audio; ndarja automatike nuk zbulon vetë kopjet me hash të ndryshëm.

## Ndarja dhe matja

```bash
python scripts/split_dataset.py private-dataset/manifest.json private-dataset/splits
python -m transcriber.evaluate --manifest private-dataset/splits/test.json --output reports/test.json
```

Duhen së paku tri sesione të pavarura. Grupet ndahen në train, validation dhe test me renditje deterministe me hash; asnjë grup nuk shfaqet në dy ndarje. Për pak sesione nuk deklarohet generalizim.

Tolerance standarde: ±50 ms. Përputhja Hungarian është një-me-një. Note precision/recall/F1 kërkojnë edhe telin/perden e saktë. Rezultatet jepen veçmas për `slow`, `fast`, `difficult`; kategoritë që mungojnë raportohen si të munguara.

Raportohen onset precision/recall/F1 dhe false positives/negatives; gabimi absolut mesatar, median dhe p95; saktësia e perdes në onset-et e përputhura; note precision/recall/F1 veçmas për telat; goditjet e reja 220 Hz; çiftet; Brier score dhe ECE. ECE vlerësohet mbi notat e parashikuara; false negatives numërohen te recall dhe nuk kanë confidence për ECE.

Kohëzgjatja mbetet e pasigurt në rezonancë. Kërko etiketa release të kontrolluara para se të deklarosh saktësi offset/duration; raporti aktual nuk e certifikon.

## Krahasimi me AI

Ruaj baseline përpara modelit. Trajno në train; zgjidh hiperparametrat dhe kalibro confidence në validation; vlerëso në testin e mbajtur veç. Modeli PyTorch është fazë e kushtëzuar nga të dhënat. Ky version nuk shpik pesha, dataset ose përqindje. Aktivizimi kërkon përmirësim të matur në note F1 dhe reattack 220 Hz, pa përkeqësim material të kohës së onset-it.

## Burime teknike

- [librosa: onset detection](https://librosa.org/doc/0.11.0/generated/librosa.onset.onset_detect.html)
- [librosa: CQT](https://librosa.org/doc/0.11.0/generated/librosa.cqt.html)
- [librosa: YIN](https://librosa.org/doc/0.11.0/generated/librosa.yin.html)
- [FastAPI: UploadFile](https://fastapi.tiangolo.com/tutorial/request-files/)

API-ja kopjon audion para nisjes së punës; thread-i nuk merr `UploadFile` që mbyllet. Audioja e përkohshme fshihet pas analizës. Rezultatet ruhen në `data/transcriber/jobs/`.
