# One rig, from a minnow to a blue whale

*Notes on building a parameterized, skeletally-driven fish in the browser.*

There is a live demo at [marine.exe.xyz](https://marine.exe.xyz) and the code is at
[github.com/orbitalfoundation/fish](https://github.com/orbitalfoundation/fish). Tap a
species, drag the *blend amount* slider, and — if you make something you like — copy a
link to it. The whole fish is encoded in the URL.

This is a writeup of how it works, and why a minnow, a boxfish, and an orca turned out
to be the same object with different numbers.

## The premise

The goal was one animation rig that could express the whole range of swimming
vertebrates — freshwater minnows, reef fish, and marine megafauna — accurately enough
to be worth looking at, but cheap enough to run in real time on one screen. Not a
museum simulation; something closer to a video game that happens to get the biology
right.

The organizing idea is that a fish is a point in a parameter space. Body proportions,
fin positions, how it swims, how its skin is coloured — all numbers. Species are just
named coordinates, and you can walk a straight line between any two of them. Dragging a
slider from "minnow" to "tuna" isn't a crossfade between two models; it's the same rig
being continuously reshaped.

## Swimming

Fish swim by passing a wave down their body and pushing against the water. Biologists
sort this into a handful of modes — anguilliform (an eel undulating head to tail),
carangiform (a mackerel flexing its back half), thunniform (a tuna holding stiff and
beating only its tail), ostraciiform (a boxfish that can't bend at all and sculls with
its tail like an oar).

It's tempting to treat these as five separate behaviours. They aren't. A 2021 study
that measured 44 species found a single amplitude curve — how far each point along the
body swings — described almost all of them. The modes differ mainly in two numbers: how
many waves sit on the body at once, and how much of the front of the body is allowed to
move. So the rig has those two as sliders, and the "modes" fall out along the way.

Frequency is set indirectly, through the Strouhal number — the ratio that relates
beat frequency, tail amplitude, and swimming speed. Animals from tuna to dolphins to
bats all cluster in a narrow band of it. Driving the rig through that ratio, rather than
by typing in a beat frequency, is what keeps a whale from flapping like a guppy when you
drag the size slider: the same "how fast should this thing swim" logic scales across
four orders of magnitude of body length.

A detail I'm fond of: the backbone is rooted not at the head but at the point about a
quarter of the way back where real fish actually pivot. Anchor the chain at the head and
the head sits nailed in place while the tail flails — it looks like someone waving a
dead fish. Root it at the pivot and the snout counter-sways against the tail on its own,
which is the real recoil physics, for free.

## Whales are fish rotated ninety degrees

Cetaceans were the test of whether the parameter idea actually held up. A whale is not
a fish — it beats its tail up and down, not side to side, and its tail is a horizontal
fluke rather than a vertical fin. But mechanically, that's a rotation. One parameter in
the rig — call it the swim plane — rotates the spine's bending axis from side-to-side to
up-and-down and simultaneously rolls the tail from vertical to horizontal. The orca and
the blue whale run the same code as the tuna, with that one number flipped, minus the
fins fish have and mammals don't.

## The skin is a chemical computer

The bold patterns on fish aren't painted on; they grow. In 1952 Alan Turing proposed
that two chemicals diffusing and reacting on a surface — one that promotes pigment, one
that suppresses it, spreading at different rates — could spontaneously organize into
spots and stripes. In 1995 a group photographed a live marine angelfish and watched its
stripes rearrange and branch exactly as the equations predicted. It was one of the first
confirmations that a real animal runs a Turing pattern on its skin.

So the fish here don't use painted textures. A reaction-diffusion simulation runs live
on the GPU every frame, and the fish reads it as its dark-pigment layer. Feed it one set
of rates and it makes spots; another and it makes a labyrinth of stripes. Bias the
diffusion along one axis and the stripes line up into clean bars. It's the same handful
of numbers producing a puffer's spots, a minnow's vermiculation, and an angelfish's
bars — and because it's live, the patterns slowly drift and reorganize, the way they do
on a growing fish.

(There was a satisfying bug here. Every striped fish kept collapsing into a solid black
blob, and no amount of retuning the pattern chemistry fixed it. The culprit was the
directional-diffusion term: it grew without bound and quietly blew up the simulation.
Clamp it, and the angelfish's bars appear. One line.)

Over the pattern sits a layered material standing in for the actual cell types in fish
skin — a dark structural layer, bright pigment, matte white, and the iridescent
guanine-crystal sheen that makes a mackerel flank shimmer as you turn it — plus a
clear coat stopping in for the mucus every fish is wrapped in.

## Heads are where you look

The hardest part to get right, and the last thing fixed, was the face. A body built as a
tube tapers naturally to a point at the snout, which is fine for a herring and completely
wrong for an orca, whose whole charm is a bulbous melon. And it matters more than
anything else, because the head is exactly where a viewer's eye goes. The fix was a
rounded snout, a "melon" bump you can dial from an eel's sharp point to a dolphin's dome,
and simply spending more of the geometry budget on the head than the mid-body.

## What it's for

Right now it's one fish in front of you and a panel of sliders. But because a fish is
just its numbers, those numbers are a genome — and that opens onto the actual idea: let
people breed fish. Cross two, mutate the offspring, explore the space of possible fish
the way you'd explore a garden. The share-a-link feature is the first quiet step toward
that; the parameter space is the seed bank.

For now, it's a nice thing to look at. Go make a fish.

---

*Built with Three.js. Research grounded in Di Santo et al. (PNAS 2021) on undulatory
kinematics, Kondo & Asai (Nature 1995) on angelfish Turing patterns, Fish & Rohr on
cetacean swimming, and standard ichthyology for the anatomy. Full citations in the
[repo README](https://github.com/orbitalfoundation/fish).*
