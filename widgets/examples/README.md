# Circuit widget examples

| File | What it is |
| --- | --- |
| `sr-latch.json` | SR latch from two cross-coupled NOR gates — `R`, `S` switches; `Q`, `Q̄` lamps |
| `d-flip-flop.json` | Clocked D flip-flop using the built-in `DFF` and a 2s `CLOCK` |
| `slide-config.json` | A whole per-slide config with the latch preloaded onto the board |

## Using one

The circuit files are what the widget's **Export** button produces, so they
round-trip: load one, edit it, export it again.

Three ways in, in order of how permanent they are:

1. **Paste into the widget** — New part → *From a saved circuit*, which turns
   it into a reusable palette block rather than putting it on the board.
2. **Slide config** — copy the object into the widget node's `circuit` key, as
   `slide-config.json` shows. Goes in `config/s<N>.json` for a PDF slide, or
   `config/sb<blankId>.json` for a blank one.
3. **`config/widget-states.json`** — keyed by widget id. This is where Beamer+
   saves live widget state, so it *overrides* the config's starting circuit.
   Good for "leave the board exactly as I left it", wrong for "always open
   like this".

## Notes on the latch

It's saved with `S` already high. A perfectly symmetric SR latch with both
inputs low is metastable: on load both NORs see `0,0`, both drive high, then
both see the other's high and drive low — a two-hop oscillation that never
settles. Holding `S` gives it a defined starting state (`Q=1`). Drop `S` back
to 0 and it holds; raise `R` and it flips.

Both files run at whatever the slide's `hop` is set to. At 1s/hop the latch
takes 2 hops to flip after a switch moves — one for the switch's wire, one for
the NOR that reacts.
