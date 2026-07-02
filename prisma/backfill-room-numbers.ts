/**
 * Backfill script: move "ห้อง XX" notes to roomNumber field on SortingBill.
 *
 * Safety rules:
 * - Only matches notes that are EXACTLY a room marker: "ห้อง 22", "ห้อง23", "ห้อง 23 "
 * - If note contains other text, do NOT modify it (just extract room number if clear)
 * - Dry-run by default; pass --apply to actually update
 * - Does NOT touch bills that already have roomNumber set
 *
 * Usage:
 *   bun run prisma/backfill-room-numbers.ts           # dry-run
 *   bun run prisma/backfill-room-numbers.ts --apply    # actual update
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

// Match notes that are purely a room marker (allow optional spaces around number)
// e.g. "ห้อง 22", "ห้อง23", "ห้อง 23 ", "ห้อง 22"
const ROOM_ONLY_REGEX = /^ห้อง\s*(\d+)\s*$/;
// Also match notes that START with "ห้อง XX" but may have trailing text
const ROOM_PREFIX_REGEX = /^ห้อง\s*(\d+)\b/;

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log('Scanning SortingBills for room-number notes...');

  const bills = await db.sortingBill.findMany({
    where: { roomNumber: null, note: { not: null } },
    select: { id: true, billNumber: true, note: true, date: true },
  });

  console.log(`Found ${bills.length} bills with note but no roomNumber.`);

  const toUpdate: Array<{ id: string; billNumber: string | null; roomNumber: string; noteIsRoomOnly: boolean; originalNote: string }> = [];

  for (const bill of bills) {
    const note = bill.note!;
    const exactMatch = note.trim().match(ROOM_ONLY_REGEX);
    if (exactMatch) {
      toUpdate.push({ id: bill.id, billNumber: bill.billNumber, roomNumber: exactMatch[1], noteIsRoomOnly: true, originalNote: note });
      continue;
    }
    // If note starts with "ห้อง XX" but has more text, extract room but keep note
    const prefixMatch = note.match(ROOM_PREFIX_REGEX);
    if (prefixMatch) {
      toUpdate.push({ id: bill.id, billNumber: bill.billNumber, roomNumber: prefixMatch[1], noteIsRoomOnly: false, originalNote: note });
    }
  }

  console.log(`\nBills to update: ${toUpdate.length}`);
  console.log('---');
  for (const u of toUpdate) {
    console.log(`  ${u.billNumber || u.id} | room: ${u.roomNumber} | noteIsRoomOnly: ${u.noteIsRoomOnly} | note: "${u.originalNote}"`);
  }

  if (!apply) {
    console.log('\n(Dry-run only. Run with --apply to update.)');
    return;
  }

  // Apply: for noteIsRoomOnly=true, set roomNumber + clear note; else just set roomNumber
  let updated = 0;
  for (const u of toUpdate) {
    await db.sortingBill.update({
      where: { id: u.id },
      data: {
        roomNumber: u.roomNumber,
        note: u.noteIsRoomOnly ? null : u.originalNote,
      },
    });
    updated++;
  }
  console.log(`\nUpdated ${updated} bills.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
