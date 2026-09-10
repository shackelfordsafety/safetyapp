/* ── Site-type hazard and control packs ──────────────────────────────────
   A JSA for mass grading beside a live Class 1 main and a JSA for mass
   grading in an open field used to be the same JSA. The task is identical;
   the thing that will hurt somebody is not. Fonzo, 2026-09-10: "a spot that
   says what type of site is this, solar farm, railroad, quarry, mine, dirt
   pit, whatever. That way it gives specific hazards and controls for that."

   Where this content came from, because it matters more than usual: every
   line was drafted from a real regulation or industry source (named on each
   pack below), published for Fonzo to review line by line, and only the
   lines he KEPT are here. He cut nine. Those are recorded at the bottom of
   this file with his reason, so nobody helpfully adds them back.

   His one repeated note across three packs -- "quick one liners, to the
   point" -- is why these are short. They sit in the same quick-add pickers
   as the existing hazard/control chips ("Use a spotter", "Wear seat belt"),
   and a chip that runs to twenty words is not a chip. The long-form version
   lives in the review page, not in a superintendent's hand at 6am.

   These are SUGGESTIONS, exactly like every other chip: they appear at the
   top of the picker when a site type is chosen, and a man taps the ones
   that apply. Nothing here is ever auto-written onto a document. */

export const SITE_TYPES = [
  { id: '', label: 'Open site', hint: 'Normal dirt work — no extra hazards' },
  { id: 'rail', label: 'Railroad', hint: 'Right-of-way, main, siding, spur, SIT yard' },
  { id: 'quarry', label: 'Quarry or mine', hint: 'Gravel pit, limestone quarry — MSHA' },
  { id: 'plant', label: 'Plant or industrial', hint: 'Live facility, permit-to-work' },
  { id: 'solar', label: 'Solar farm', hint: 'Civil work on an energizing site' },
  { id: 'pit', label: 'Dirt pit', hint: 'Borrow pit' },
];

/* `basis` shows on the Job Info screen once a type is picked. It is there so
   a superintendent knows these are somebody's rules, not our suggestions --
   particularly on rail, where the railroad's own job briefing is required by
   law and this JSA cannot stand in for it. */
export const SITE_PACKS = {
  rail: {
    label: 'Railroad',
    basis: 'FRA 49 CFR Part 214 — applies to contractors. The railroad’s job briefing is still required; this does not replace it.',
    hazards: [
      'Train movement on the track',
      'Movement on the adjacent track',
      'Fouling the track',
      'No on-track protection in place yet',
      'Equipment or load fouling a live track',
      'Restricted sight distance',
      'Noise masking an approaching train',
      'Shoving moves and remote-control locomotives',
      'Ballast footing, switches and derails',
      'No contact with the RWIC',
    ],
    controls: [
      'Job briefing before fouling track',
      'Every man acknowledges the briefing',
      'Confirm working limits before entry',
      'Know the RWIC and how to reach him',
      'Watchman has no other duties',
      'Re-brief when the protection changes',
      'Confirm clearance before swinging',
      'Keep spoil and equipment out of the foul',
      'Railroad-required hi-vis',
      'Never foul a track for a shortcut',
    ],
  },
  quarry: {
    label: 'Quarry or mine',
    basis: 'MSHA, not OSHA — 30 CFR Parts 46 and 56. Site-specific training is required before anybody goes on the property.',
    hazards: [
      'Highwall or bank failure',
      'Unsupported face',
      'Pit crest and drop-offs',
      'Haul road traffic',
      'Powered haulage',
      'Crusher, conveyor and wash plant',
      'Blasting and misfires',
      'Silica dust',
      'Water in the pit',
      'Ground change after rain or freeze',
    ],
    controls: [
      'Re-check the highwall after rain or freeze',
      'Scale loose material from a safe spot',
      'Stay back from the crest',
      'Berms to mid-axle height',
      'Follow the site traffic pattern',
      'Eye contact before approaching haulage',
      'LOTO and block before plant work',
      'Know the blast schedule, clear on the signal',
      'Wet down for silica dust',
    ],
  },
  plant: {
    label: 'Plant or industrial',
    basis: 'The plant’s permit-to-work governs. Hot work follows OSHA 1910.252 / NFPA 51B.',
    hazards: [
      'Live process lines and piping',
      'Flammable atmosphere',
      'H2S and toxic gas',
      'Ignition sources near process',
      'Unknown buried lines',
      'Confined space',
      'Plant traffic and restricted routes',
      'Unfamiliar alarms and evacuation',
      'Work outside the permit',
    ],
    controls: [
      'Plant permit before any work',
      'Plant orientation and daily sign-in',
      'Gas test before and during hot work',
      'Gas monitor and escape mask',
      'Wear FRC where required',
      'Verify isolation — a closed valve is not isolation',
      'Hand-expose buried lines',
      'Know the alarms and muster point',
      'Stop and call the plant contact',
    ],
  },
  solar: {
    label: 'Solar farm',
    basis: 'Modules make power in any daylight — killing the AC side does not de-energize the array.',
    hazards: [
      'Energized DC in the array',
      /* Fonzo cut the long combiner-box/cable hazard and the trenching one
         ("we dont do anything besides the dirt work on solar farms"), but
         KEPT the control "Locate and mark buried DC cable". A control with
         no hazard behind it reads like a rule nobody can explain, so the
         part that actually reaches a dirt crew -- cable already in the
         ground where they are about to dig -- stays as its own short line.
         Flagged to him; cut it if that is not the call. */
      'Buried DC cable in the work area',
      'Long distance to help, poor coverage',
      'Heat with no shade',
      'Traffic on long access roads',
    ],
    controls: [
      'Stay out of combiner boxes and inverters',
      'Confirm which blocks are energized today',
      'Locate and mark buried DC cable',
      'Bring shade, water and breaks',
      'Confirm phone or radio coverage',
      'Posted speed on access roads',
    ],
  },
  pit: {
    label: 'Dirt pit',
    basis: 'Depending on the operation this can fall under MSHA rather than OSHA — worth confirming per site.',
    hazards: [
      'Face or bank failure',
      'Pit crest and drop-offs',
      'Haul road condition and traffic',
      'Standing water in the pit',
      'Soft floor — bogging or rolling',
      'Loading trucks — struck-by',
      'Blind and single-lane pinch points',
      'Ground change after rain',
    ],
    controls: [
      'Walk the pit before work and after rain',
      'Never dig under an overhang',
      'Stay back from the crest',
      'Maintain the haul road, set traffic flow',
      'Nobody on foot in the loading area',
      'Never swing a loaded bucket over a truck cab',
      'Confirm the floor will carry the machine',
      'Spotter at blind pinch points',
    ],
  },
};

/* CUT BY FONZO, 2026-09-10 — do not re-add without asking him.

   Quarry:
     "Part 46 site-specific hazard training before anybody goes on the
      property"
     "Workplace examination of the area before work begins, and record it"
       Both are real MSHA requirements, but neither is something the crew
       filling out a JSA controls -- training happens before anybody
       mobilizes, and the workplace examination belongs to the mine
       operator. They are prerequisites, not line items. Kept on the
       pack's `basis` line instead so a super still sees Part 46 named.

   Solar -- "we dont do anything besides the dirt work on solar farms":
     "Pile driving — struck-by, pinch points, hand placement, noise"
     "Combiner boxes, inverter pads and buried DC collection cable"
     "Repetitive lifting of modules and racking"
     "Trenching for collection cable"
     "Treat every module and DC conductor as live whenever there is
      daylight on it"
     "Nobody guides a pile by hand; hands clear of the hammer and the pile"
     "Hearing protection at the pile driver"
       Shackelford does the civil scope only. Somebody else drives the
       piles, sets the modules and pulls the cable. What survives is what
       reaches a dirt crew: which blocks are hot, what is buried where they
       are digging, and a field with no shade on it. */

export function packFor(siteType) {
  return SITE_PACKS[siteType] || null;
}

/* Prepends the site pack to an existing quick-add group list. Returns the
   same array when there is no site type, so the common case allocates
   nothing and the memo below it stays stable. */
export function withSitePack(groups, siteType, kind) {
  const pack = packFor(siteType);
  if (!pack || !pack[kind] || !pack[kind].length) return groups;
  return [{ title: `${pack.label} — ${kind === 'hazards' ? 'hazards' : 'controls'}`, items: pack[kind] }, ...groups];
}
