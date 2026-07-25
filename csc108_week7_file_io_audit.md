# Week 7 File I/O Problem Audit

Purpose: figure out which PCRS problems cover material we're cutting, which ones no longer match how we're teaching the material, and where we need new problems for things the new script introduces.

## Structured Files is being cut

MC 613, 614, 615, 616, 617, and 618 all exist to test the structured files pattern (nested while loops, reading a file with an unknown number of entries, the pet treats example). Since that section is going away, all six should come out.

## The new script changes what "reading a file" means, and a chunk of the current bank doesn't match anymore

This is the bigger issue. The old problems assume students learned four named ways to read a file, `.read()`, `.readline()`, `.readlines()`, and `for line in file`, and several problems ask students to pick the right one for a situation (large CSV, sorting, grabbing one line out of a big file, and so on).

The new script doesn't teach it that way. Part 1 only shows `for line in file`. Part 2 skips straight to the `csv` module and teaches `csv.reader(f)`, iterating over `reader`, and reading one row at a time with `next(reader)`. Nowhere in the script does it introduce `.read()`, `.readline()`, or `.readlines()` as methods by name.

That means these problems are testing vocabulary the new videos never teach:

- MC 285, uses `.read()` and string indexing
- MC 286, asks students to choose among read/readline/readlines/for-line-in-file for a big CSV
- MC 287, same four choices, for a sorting task
- MC 172, same four choices, for pulling one line out of a file with a preamble
- MC 323, choices include `.readlines()` and `.readline()` by name

Worth checking with the team on whether this is intentional (are we deliberately dropping `.read()`/`.readline()`/`.readlines()` in favor of `for` loops and `csv.reader`/`next()`?). If so, these five problems need to be reworded or replaced to match the new approach rather than removed outright, since the underlying skill (pick the right tool for the job) is still worth testing, just with the new vocabulary.

MC 173 (removing the extra blank line with `.strip()`/`.rstrip()`) still lines up fine, the script demos exactly this with `.strip()`.

## Append mode might be gone too

The script only ever opens files in `'r'` or `'w'` mode. Append mode (`'a'`) isn't mentioned anywhere. MC 305 tests recognizing `'r'`, `'w'`, and `'a'`. If append mode isn't being taught anymore, that problem needs to drop the `'a'` option or get replaced.

## New material with no matching problems at all

The script introduces a handful of things that nothing in the current bank touches:

- The `csv` module itself: `import csv`, `csv.reader(f)`, and treating the result as a list of lists of strings (no more manual comma splitting or newline stripping)
- Indexing into a row from the reader, e.g. `row[0]`, to pull out one column
- `next(reader)` to read a single row, and that calling it again after the file is exhausted raises `StopIteration`
- Using `next(reader)` to skip the header row before looping over the rest with `for row in reader`
- Writing a function that takes an already-open file (typed as `TextIO`) and the rule that whoever opened a file is responsible for closing it, so a function should not close a file it didn't open itself
- `copy_file`, a function that reads from one open file and writes to a new one, combining reading and writing in a single function
- `.write()` returning an int (the number of characters written), which isn't tested anywhere currently

Given how much of the script is built around the `csv` module and the open-file-as-parameter pattern, I'd expect we need at least two or three new problems here: one on reading rows with `csv.reader` and indexing into them, one on `next()` and the header-skipping pattern (this is a good replacement for the structured-files-style "function that takes an open file" testing we're losing), and one on the closing-responsibility rule, since that's a design idea that's easy to get wrong and isn't tested at all right now.

## Writing Files, still solid

MC 288 and MC 175 both hold up fine against the new script. Writing line by line with `.write()` and remembering the `\n` is still exactly what's taught.

## Perform, Part 1

MC 303 (writing to a file opened in read mode) and `every_second_line` (iterating with index tracking and `.strip()`) both still fit. MC 323 is flagged above along with the other approach-comparison questions, and MC 305 is flagged above for the append mode question.

## Not related to File I/O

MC 503, 180, 177, 178, and 392 on the Prepare Exercise page are about tuples and dictionaries, not files, so I've left them out of this audit.

## Summary

Remove: MC 613, 614, 615, 616, 617, 618.

Needs a decision, then likely a rewrite rather than removal: MC 285, 286, 287, 172, 323 (approach-comparison questions built around `.read()`/`.readline()`/`.readlines()`), and MC 305 (append mode).

Still fine as is: MC 288, 175, 173, 303, and `every_second_line`.

New problems worth writing: reading and indexing rows with `csv.reader`, `next()` and header-skipping (including the `StopIteration` behaviour), and the rule about who's responsible for closing a file that's passed into a function.
