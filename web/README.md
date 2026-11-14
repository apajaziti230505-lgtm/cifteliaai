# Çiftelia Studio AI – Web 2.1

Hape versionin web (kur GitHub Pages është aktiv):
https://apajaziti230505-lgtm.github.io/cifteliaai/

## Çfarë është e re

- **Gjej dhe ndiq duart vetë**: përmes MediaPipe Hand Landmarker, vizaton katrorë të veçantë për dorën e gishtave dhe dorën me plektrum. Çdo kornizë videoje analizohet në shfletues. MediaPipe përdor një model që shkarkohet fillimisht nga interneti.
- Kur ka dy duar në pamje, rolet caktohen sipas vendndodhjes përgjatë qafës së çiftelisë; mund të zgjedhësh opsionin **Qafa është në të djathtë** në rast të videos së pasqyruar. Nëse duket vetëm një dorë, etiketohet thjesht **DORA** për të mos e hamendësuar rolin.
- **Qafa / perdet që lëvizin**: nëse zgjedh zonën e qafës dhe shënon perdet **4, 7 dhe 8**, programi përpiqet t'i zhvendosë bashkë me çiftelinë duke ndjekur teksturën e videos. Ndarja 1–13 që shfaqet nga këto tri pika është **e përafërt**, jo një zbulim i verifikuar i 13 perdeve.
- Audioja përcakton kandidatët e notave; lëvizja e dorës me plektrum jep një vlerësim **↓/↑**. Kur rezultati është i paqartë vendoset **?** ose pika e rishikimit.
- **Zoom, rrëshqitje majtas/djathtas, shtim/fshirje/zhvendosje të notave, 1×/0.5×/0.25× dhe eksport/import JSON**.

## Si përdoret

1. Ngarko një MP4 ku të dy duart duken qartë.
2. Kliko **Gjej dhe ndiq duart vetë**. Ktheje videon në PLAY për t'i parë katrorët në lëvizje.
3. Për saktësi më të mirë të pozicionit të gishtave, ndalo videon te një kornizë e pastër, cakto **Zona e gishtave** dhe shëno pikat **4, 7, 8** me klikim mbi qafë. Pas kësaj katrorët dhe pikat synojnë të ndjekin çiftelinë në lëvizje.
4. Kliko **Analizo notat + dorën**, dhe pas përfundimit kontrollo/cilëso rezultatet përpara eksportit.

## Kufizime të rëndësishme

Analiza është **heuristike**, jo model i trajnuar posaçërisht për çifteli, dhe nuk ka saktësi të provuar 80%. MediaPipe zbulon duart, por nuk provon në mënyrë të sigurt cilën perde e shtyp gishti. Ndjekja e qafës me teksturë funksionon për lëvizje të moderuara dhe mund të humbasë objektin nga turbullimi, mbulimi i gishtave, ndryshimet e këndit ose ndriçimit. Për më shumë saktësi duhet kalibrim, video cilësore dhe kontroll i notave.

Skedarët audio/video **nuk ngarkohen** në server nga kjo faqe. Vetëm modeli MediaPipe dhe bibliotekat e tij shkarkohen nga CDN në përdorimin e parë. GitHub Pages nuk ekzekuton server Python.
