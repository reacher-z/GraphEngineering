"""A portable AES-256-GCM reference implementation.

Section 5.2 fixes ``A256GCM`` with a 12-byte nonce and a 16-byte tag as the
baseline portable protected blob, and Section 5.3 leaves production key
derivation, KMS protocol, and hardware boundary to the provider.  This module
supplies only the algorithm so the shipped runtime has no third-party
dependency and the conformance vectors are recomputed natively.

It is deliberately narrow and is **not** constant-time: a deployment whose
threat model includes local timing side channels must supply a
:class:`~graph_engineering.redaction.keys.Protector` backed by a vetted library
or hardware module.  The guard never chooses this implementation for a value it
cannot also protect through an operator-supplied protector.
"""

from __future__ import annotations

from typing import Final

_SBOX: Final[tuple[int, ...]] = (
    0x63, 0x7C, 0x77, 0x7B, 0xF2, 0x6B, 0x6F, 0xC5, 0x30, 0x01, 0x67, 0x2B, 0xFE, 0xD7, 0xAB, 0x76,
    0xCA, 0x82, 0xC9, 0x7D, 0xFA, 0x59, 0x47, 0xF0, 0xAD, 0xD4, 0xA2, 0xAF, 0x9C, 0xA4, 0x72, 0xC0,
    0xB7, 0xFD, 0x93, 0x26, 0x36, 0x3F, 0xF7, 0xCC, 0x34, 0xA5, 0xE5, 0xF1, 0x71, 0xD8, 0x31, 0x15,
    0x04, 0xC7, 0x23, 0xC3, 0x18, 0x96, 0x05, 0x9A, 0x07, 0x12, 0x80, 0xE2, 0xEB, 0x27, 0xB2, 0x75,
    0x09, 0x83, 0x2C, 0x1A, 0x1B, 0x6E, 0x5A, 0xA0, 0x52, 0x3B, 0xD6, 0xB3, 0x29, 0xE3, 0x2F, 0x84,
    0x53, 0xD1, 0x00, 0xED, 0x20, 0xFC, 0xB1, 0x5B, 0x6A, 0xCB, 0xBE, 0x39, 0x4A, 0x4C, 0x58, 0xCF,
    0xD0, 0xEF, 0xAA, 0xFB, 0x43, 0x4D, 0x33, 0x85, 0x45, 0xF9, 0x02, 0x7F, 0x50, 0x3C, 0x9F, 0xA8,
    0x51, 0xA3, 0x40, 0x8F, 0x92, 0x9D, 0x38, 0xF5, 0xBC, 0xB6, 0xDA, 0x21, 0x10, 0xFF, 0xF3, 0xD2,
    0xCD, 0x0C, 0x13, 0xEC, 0x5F, 0x97, 0x44, 0x17, 0xC4, 0xA7, 0x7E, 0x3D, 0x64, 0x5D, 0x19, 0x73,
    0x60, 0x81, 0x4F, 0xDC, 0x22, 0x2A, 0x90, 0x88, 0x46, 0xEE, 0xB8, 0x14, 0xDE, 0x5E, 0x0B, 0xDB,
    0xE0, 0x32, 0x3A, 0x0A, 0x49, 0x06, 0x24, 0x5C, 0xC2, 0xD3, 0xAC, 0x62, 0x91, 0x95, 0xE4, 0x79,
    0xE7, 0xC8, 0x37, 0x6D, 0x8D, 0xD5, 0x4E, 0xA9, 0x6C, 0x56, 0xF4, 0xEA, 0x65, 0x7A, 0xAE, 0x08,
    0xBA, 0x78, 0x25, 0x2E, 0x1C, 0xA6, 0xB4, 0xC6, 0xE8, 0xDD, 0x74, 0x1F, 0x4B, 0xBD, 0x8B, 0x8A,
    0x70, 0x3E, 0xB5, 0x66, 0x48, 0x03, 0xF6, 0x0E, 0x61, 0x35, 0x57, 0xB9, 0x86, 0xC1, 0x1D, 0x9E,
    0xE1, 0xF8, 0x98, 0x11, 0x69, 0xD9, 0x8E, 0x94, 0x9B, 0x1E, 0x87, 0xE9, 0xCE, 0x55, 0x28, 0xDF,
    0x8C, 0xA1, 0x89, 0x0D, 0xBF, 0xE6, 0x42, 0x68, 0x41, 0x99, 0x2D, 0x0F, 0xB0, 0x54, 0xBB, 0x16,
)

_RCON: Final[tuple[int, ...]] = (
    0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36, 0x6C, 0xD8, 0xAB, 0x4D,
)

_NONCE_BYTES: Final = 12
_TAG_BYTES: Final = 16
_KEY_BYTES: Final = 32
_ROUNDS: Final = 14


class AeadError(ValueError):
    """Raised when authentication fails or an input has the wrong length."""


def _xtime(value: int) -> int:
    shifted = value << 1
    return (shifted ^ 0x1B) & 0xFF if shifted & 0x100 else shifted


def _multiply(a: int, b: int) -> int:
    result = 0
    while b:
        if b & 1:
            result ^= a
        a = _xtime(a)
        b >>= 1
    return result


def _expand_key(key: bytes) -> list[list[int]]:
    words = [list(key[index : index + 4]) for index in range(0, _KEY_BYTES, 4)]
    total = 4 * (_ROUNDS + 1)
    for index in range(8, total):
        previous = list(words[index - 1])
        if index % 8 == 0:
            previous = previous[1:] + previous[:1]
            previous = [_SBOX[byte] for byte in previous]
            previous[0] ^= _RCON[index // 8 - 1]
        elif index % 8 == 4:
            previous = [_SBOX[byte] for byte in previous]
        words.append([words[index - 8][position] ^ previous[position] for position in range(4)])
    return words


def _encrypt_block(words: list[list[int]], block: bytes) -> bytes:
    state = [list(block[index : index + 4]) for index in range(0, 16, 4)]
    _add_round_key(state, words, 0)
    for round_index in range(1, _ROUNDS):
        _sub_bytes(state)
        _shift_rows(state)
        _mix_columns(state)
        _add_round_key(state, words, round_index)
    _sub_bytes(state)
    _shift_rows(state)
    _add_round_key(state, words, _ROUNDS)
    return bytes(byte for column in state for byte in column)


def _add_round_key(state: list[list[int]], words: list[list[int]], round_index: int) -> None:
    for column in range(4):
        word = words[round_index * 4 + column]
        for row in range(4):
            state[column][row] ^= word[row]


def _sub_bytes(state: list[list[int]]) -> None:
    for column in range(4):
        for row in range(4):
            state[column][row] = _SBOX[state[column][row]]


def _shift_rows(state: list[list[int]]) -> None:
    for row in range(1, 4):
        shifted = [state[(column + row) % 4][row] for column in range(4)]
        for column in range(4):
            state[column][row] = shifted[column]


def _mix_columns(state: list[list[int]]) -> None:
    for column in range(4):
        a0, a1, a2, a3 = state[column]
        state[column] = [
            _multiply(a0, 2) ^ _multiply(a1, 3) ^ a2 ^ a3,
            a0 ^ _multiply(a1, 2) ^ _multiply(a2, 3) ^ a3,
            a0 ^ a1 ^ _multiply(a2, 2) ^ _multiply(a3, 3),
            _multiply(a0, 3) ^ a1 ^ a2 ^ _multiply(a3, 2),
        ]


def _ghash_multiply(x: int, y: int) -> int:
    product = 0
    value = x
    for bit in range(127, -1, -1):
        if (y >> bit) & 1:
            product ^= value
        if value & 1:
            value = (value >> 1) ^ (0xE1 << 120)
        else:
            value >>= 1
    return product


def _ghash(subkey: int, data: bytes) -> int:
    accumulator = 0
    for offset in range(0, len(data), 16):
        block = data[offset : offset + 16].ljust(16, b"\x00")
        accumulator = _ghash_multiply(accumulator ^ int.from_bytes(block, "big"), subkey)
    return accumulator


def _inc32(counter: int) -> int:
    prefix = counter >> 32
    return (prefix << 32) | ((counter + 1) & 0xFFFFFFFF)


def _gctr(words: list[list[int]], counter: int, payload: bytes) -> bytes:
    if not payload:
        return b""
    output = bytearray()
    prefix = counter >> 32
    block_counter = counter & 0xFFFFFFFF
    for offset in range(0, len(payload), 16):
        block_counter = (block_counter + 1) & 0xFFFFFFFF if offset else block_counter
        counter_block = ((prefix << 32) | block_counter).to_bytes(16, "big")
        keystream = _encrypt_block(words, counter_block)
        chunk = payload[offset : offset + 16]
        output.extend(byte ^ keystream[index] for index, byte in enumerate(chunk))
    return bytes(output)


def aes_256_gcm_encrypt(
    key: bytes,
    nonce: bytes,
    plaintext: bytes,
    associated_data: bytes,
) -> tuple[bytes, bytes]:
    """Return ``(ciphertext, tag)`` for a 32-byte key and 12-byte nonce."""

    _check_key(key)
    if type(nonce) is not bytes or len(nonce) != _NONCE_BYTES:
        raise AeadError("A256GCM requires a 12-byte nonce")
    words = _expand_key(key)
    subkey = int.from_bytes(_encrypt_block(words, b"\x00" * 16), "big")
    initial_counter = int.from_bytes(nonce + b"\x00\x00\x00\x01", "big")
    ciphertext = _gctr(words, _inc32(initial_counter), plaintext)
    tag = _tag(words, subkey, initial_counter, associated_data, ciphertext)
    return ciphertext, tag


def aes_256_gcm_decrypt(
    key: bytes,
    nonce: bytes,
    ciphertext: bytes,
    tag: bytes,
    associated_data: bytes,
) -> bytes:
    """Authenticate then decrypt; a bad tag raises :class:`AeadError`."""

    _check_key(key)
    if type(nonce) is not bytes or len(nonce) != _NONCE_BYTES:
        raise AeadError("A256GCM requires a 12-byte nonce")
    if type(tag) is not bytes or len(tag) != _TAG_BYTES:
        raise AeadError("A256GCM requires a 16-byte tag")
    words = _expand_key(key)
    subkey = int.from_bytes(_encrypt_block(words, b"\x00" * 16), "big")
    initial_counter = int.from_bytes(nonce + b"\x00\x00\x00\x01", "big")
    expected = _tag(words, subkey, initial_counter, associated_data, ciphertext)
    difference = 0
    for left, right in zip(expected, tag, strict=True):
        difference |= left ^ right
    if difference:
        raise AeadError("A256GCM authentication failed")
    return _gctr(words, _inc32(initial_counter), ciphertext)


def _tag(
    words: list[list[int]],
    subkey: int,
    initial_counter: int,
    associated_data: bytes,
    ciphertext: bytes,
) -> bytes:
    padded_aad = associated_data + b"\x00" * (-len(associated_data) % 16)
    padded_ciphertext = ciphertext + b"\x00" * (-len(ciphertext) % 16)
    lengths = (len(associated_data) * 8).to_bytes(8, "big") + (len(ciphertext) * 8).to_bytes(
        8, "big"
    )
    digest = _ghash(subkey, padded_aad + padded_ciphertext + lengths)
    return _gctr(words, initial_counter, digest.to_bytes(16, "big"))


def _check_key(key: bytes) -> None:
    if type(key) is not bytes or len(key) != _KEY_BYTES:
        raise AeadError("A256GCM requires a 32-byte protection key")
