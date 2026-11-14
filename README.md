# Çiftelia Studio AI

Program për çifteli me analizë lokale në Python dhe **version Web për luajtje dhe korrigjim të tablaturës**.

## Hap nga Web

Pas aktivizimit të GitHub Pages, hape: **https://apajaziti230505-lgtm.github.io/cifteliaai/**

Për ta aktivizuar: **Settings → Pages → Build and deployment → Deploy from a branch → main → /(root) → Save**.

Versioni Web mbështet:
- Ngarkimin dhe luajtjen e MP3/MP4 në shfletues (audio/video nuk dërgohen te GitHub)
- Shpejtësi **1×, 0.5×, 0.25×**
- Shtim, fshirje dhe zhvendosje të notave me kohën përkatëse
- Goditje poshtë/lart dhe lëvizje të heshtura, të shënuara manualisht
- Import dhe eksport JSON, ruajtje të notave në shfletues (skedarin e medias duhet ta zgjedhësh përsëri pas rifreskimit)

**Kufizim:** GitHub Pages është statik. Analiza automatike me Python e notave, goditjeve dhe videos kërkon versionin lokal të kompjuterit. Ajo nuk kryhet automatikisht në versionin Web.

## Programi lokal për Windows
1. Instalo Python 3.10+.
2. Shkarko kodin (Code → Download ZIP).
3. Shpaketoje dhe ekzekuto `Start_Windows.bat`.

Lexo [udhëzuesin në shqip](UDHEZUES_SHQIP.md) dhe [informacionin e versionit Web](web/README.md).

**Status:** Version provë; algoritmi i analizës nuk ka saktësi të certifikuar mbi 80%. Verifiko notat manualisht.
