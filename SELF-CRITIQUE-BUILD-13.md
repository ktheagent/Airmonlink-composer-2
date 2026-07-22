# Build 13 self-critique

## Findings and repairs made

1. The first Sol-fa reflow pass hid empty layers only when a layer was empty across the whole score. That still left blank rows in systems where the layer had no local material. It was repaired to evaluate authored content per system.
2. The first lyric repair aligned verses by each note's local array index. Missing verses on one note could shift later verses vertically. It was repaired by deriving stable verse lanes for the complete system.
3. Verse numbers were still repeated beneath every staff note when several verses existed. Staff and Sol-fa rendering were repaired so the number labels each verse once per system.
4. The metadata render cache originally omitted dedication, date, arranger and lyricist. Its signature was expanded so editing these fields refreshes both score views.
5. The old collapsed right dock still reserved a narrow strip. Defaults now close every right panel, producing a true zero-width score obstruction until a panel is requested.

## Remaining verification boundary

The source is internally consistent and fully passes its available automated suite, but “perfect” cannot honestly mean Windows-device verified here. A final release decision still requires opening the application on Windows and visually checking long real-world SATB scores at several display scales, printing to PDF, testing an actual MIDI keyboard, and compiling the NSIS/portable packages. The missing Python WebSocket dependency also prevented the existing screenshot smoke script from running in this workspace.

## Release assessment

Build 13 is suitable as a source-validated release candidate. It should not be described as a compiled or Windows-device-tested final binary until those remaining checks are completed.
