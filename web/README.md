# Çiftelia Studio AI – Web

Hap `/index.html` në GitHub Pages. Ky version është **statik**, pa server Python.

Funksionet: luajtje MP3/MP4 lokalisht në shfletues, shpejtësi 1× / 0.5× / 0.25×, shtim/fshirje/zhvendosje notash, grupe, import/eksport JSON, ruajtje e përkohshme e notave në localStorage.

Audio/video **nuk ngarkohen në GitHub**, por hapen si `blob:` nga skedari i zgjedhur. Pas rifreskimit zgjidh përsëri të njëjtin skedar për të rikthyer notat e ruajtura. Eksporto JSON si kopje rezervë.

Analiza automatike me Python, njohja e goditjeve dhe konvertimi i videos **nuk ekzekutohen në GitHub Pages**. Përdor `Start_Windows.bat` për analizë automatike.

Për aktivizimin e GitHub Pages: **Settings → Pages → Deploy from a branch → main → /(root) → Save**.
