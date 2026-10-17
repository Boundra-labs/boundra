/** 0x1234…abcd: enough to recognise an address without crowding the layout. */
export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
