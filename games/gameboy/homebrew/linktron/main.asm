; Link Tron — two-player light cycles over the Game Boy link cable.
; Copyright (c) 2026 Ben Parrack. MIT license (see LICENSE).
;
; Link protocol
;   Title: both consoles listen (SB=$55, SC=$80). Whoever presses START clocks $AA out; if $55
;   comes back there is a partner, and the clocking side becomes player 1 (it drives the clock
;   from then on), the listener becomes player 2.
;   Game: once per frame P1 clocks out its input code and gets P2's back. P2 re-arms with its
;   input as soon as it has run the tick, so it is always listening by P1's next VBlank. Input
;   codes are never $FF, so P1 retries whenever $FF (nobody listening) comes back. Both consoles
;   then run the same deterministic tick on the same pair of inputs.
;   Input code: 0 = no direction, 1-4 = right/left/up/down, +8 = A or START held.

DEF rP1    EQU $FF00
DEF rSB    EQU $FF01
DEF rSC    EQU $FF02
DEF rNR10  EQU $FF10
DEF rNR11  EQU $FF11
DEF rNR12  EQU $FF12
DEF rNR13  EQU $FF13
DEF rNR14  EQU $FF14
DEF rNR41  EQU $FF20
DEF rNR42  EQU $FF21
DEF rNR43  EQU $FF22
DEF rNR44  EQU $FF23
DEF rNR50  EQU $FF24
DEF rNR51  EQU $FF25
DEF rNR52  EQU $FF26
DEF rLCDC  EQU $FF40
DEF rSTAT  EQU $FF41
DEF rSCY   EQU $FF42
DEF rSCX   EQU $FF43
DEF rLY    EQU $FF44
DEF rBGP   EQU $FF47
DEF rIE    EQU $FFFF

DEF PAD_START EQU $80
DEF PAD_A     EQU $10

DEF SPEED     EQU 5          ; frames per cell
DEF WIN_SCORE EQU 5

DEF T_WALL   EQU 1
DEF T_TRAIL1 EQU 2
DEF T_TRAIL2 EQU 3
DEF T_HEAD1  EQU 4
DEF T_HEAD2  EQU 5

DEF ST_READY EQU 0           ; countdown before a round
DEF ST_PLAY  EQU 1
DEF ST_OVER  EQU 2           ; round result on screen
DEF ST_MATCH EQU 3           ; match decided, waiting for A/START

DEF STATUS   EQU $9800 + 5   ; 10-character message area on row 0

SECTION "vblank", ROM0[$40]
    reti

SECTION "header", ROM0[$100]
    nop
    jp Start
    ds $150 - @, 0

SECTION "main", ROM0[$150]
Start:
    di
    ld sp, $E000
    call LcdOff
    ld hl, $C000                ; clear WRAM
    ld bc, $2000
.clr:
    xor a
    ld [hl+], a
    dec bc
    ld a, b
    or c
    jr nz, .clr
    ld hl, $8000
    ld de, GameTiles
    ld bc, GameTiles.end - GameTiles
    call Copy
    ld hl, $8000 + $20 * 16
    ld de, Font
    ld bc, Font.end - Font
    call Copy
    ld a, %11100100
    ldh [rBGP], a
    xor a
    ldh [rSCX], a
    ldh [rSCY], a
    ld a, $80                   ; sound on, full volume, all channels both sides
    ldh [rNR52], a
    ld a, $77
    ldh [rNR50], a
    ld a, $FF
    ldh [rNR51], a
    ld a, 1
    ldh [rIE], a
    ei

; ---------------- title / partner handshake ----------------
Title:
    call LcdOff
    call ClearMap
    ld de, $9800 + 3 * 32 + 5
    ld hl, strTitle
    call PrintStr
    ld de, $9800 + 6 * 32 + 2
    ld hl, strTitle2
    call PrintStr
    ld de, $9800 + 8 * 32 + 5
    ld hl, strTitle3
    call PrintStr
    ld de, $9800 + 12 * 32 + 4
    ld hl, strPressStart
    call PrintStr
    ld de, $9800 + 16 * 32 + 2
    ld hl, strCredit
    call PrintStr
    call LcdOn
.arm:
    ld a, $55
    ldh [rSB], a
    ld a, $80
    ldh [rSC], a
.loop:
    halt
    nop
    ldh a, [rSC]
    bit 7, a
    jr z, .clocked
    call ReadPad
    ld a, [wPadNew]
    and PAD_START
    jr z, .loop
    ld a, $AA                   ; try to become player 1
    ldh [rSB], a
    ld a, $81
    ldh [rSC], a
.wait:
    ldh a, [rSC]
    bit 7, a
    jr nz, .wait
    ldh a, [rSB]
    cp $55
    jr z, .p1
    ld de, $9800 + 14 * 32 + 1
    ld hl, strNoPartner
    call PrintStr
    call Beep
    jr .arm
.clocked:
    ldh a, [rSB]
    cp $AA
    jr nz, .arm
    ld a, 1
    jr .go
.p1:
    xor a
.go:
    ld [wRole], a

; ---------------- match ----------------
    xor a
    ld [wScore1], a
    ld [wScore2], a
    ld [wMatchOver], a
NewRound:
    call LcdOff
    call ClearMap
    call DrawArena
    ld a, 4
    ld [wP1X], a
    ld a, 15
    ld [wP2X], a
    ld a, 9
    ld [wP1Y], a
    ld [wP2Y], a
    xor a                       ; P1 heads right, P2 left
    ld [wP1Dir], a
    ld [wP1Next], a
    inc a
    ld [wP2Dir], a
    ld [wP2Next], a
    ld a, [wP1X]
    ld b, a
    ld a, [wP1Y]
    ld c, a
    ld a, T_HEAD1
    call SetCell
    ld a, [wP2X]
    ld b, a
    ld a, [wP2Y]
    ld c, a
    ld a, T_HEAD2
    call SetCell
    call DrawScores
    ld hl, strYouP1
    ld a, [wRole]
    or a
    jr z, .you
    ld hl, strYouP2
.you:
    ld de, STATUS
    call PrintStr
    ld a, ST_READY
    ld [wState], a
    ld a, 90
    ld [wTimer], a
    ld a, SPEED
    ld [wMove], a
    xor a
    ld [wReset], a
    call LcdOn

FrameLoop:
    ld a, [wRole]
    or a
    jr nz, .p2
    halt                        ; P1: one exchange per VBlank
    nop
    call ReadPad
    call Encode
    ld b, a
.retry:
    ld a, b
    ldh [rSB], a
    ld a, $81
    ldh [rSC], a
.w1:
    ldh a, [rSC]
    bit 7, a
    jr nz, .w1
    ldh a, [rSB]
    cp $FF
    jr z, .retry                ; P2 wasn't listening yet
    ld [wP2In], a
    ld a, b
    ld [wP1In], a
    jr .tick
.p2:
    call ReadPad
    call Encode
    ld b, a
    ldh [rSB], a
    ld a, $80
    ldh [rSC], a
.w2:
    ldh a, [rSC]
    bit 7, a
    jr nz, .w2
    ldh a, [rSB]
    ld [wP1In], a
    ld a, b
    ld [wP2In], a
.tick:
    call GameTick
    ld a, [wReset]
    or a
    jr z, FrameLoop
    jp NewRound

; ---------------- game logic (identical on both consoles) ----------------

MACRO APPLY_INPUT ; \1 = player prefix
    ld a, [\1In]
    and 7
    jr z, .none\@
    dec a
    ld [\1Next], a
.none\@:
ENDM

; Turns (unless it would reverse), works out the next cell and whether it's occupied.
MACRO PREP ; \1 = player prefix
    ld a, [\1Dir]
    ld b, a
    ld a, [\1Next]
    ld c, a
    xor 1
    cp b
    jr z, .keep\@
    ld a, c
    ld [\1Dir], a
.keep\@:
    ld a, [\1Dir]
    add a, a
    ld e, a
    ld d, 0
    ld hl, DirTable
    add hl, de
    ld a, [\1X]
    add a, [hl]
    ld [\1NX], a
    ld b, a
    inc hl
    ld a, [\1Y]
    add a, [hl]
    ld [\1NY], a
    ld c, a
    call GridAddr
    ld a, [hl]
    ld [\1Crash], a
ENDM

MACRO ADVANCE ; \1 = player prefix, \2 = trail tile, \3 = head tile
    ld a, [\1X]
    ld b, a
    ld a, [\1Y]
    ld c, a
    ld a, \2
    call SetCell
    ld a, [\1NX]
    ld [\1X], a
    ld b, a
    ld a, [\1NY]
    ld [\1Y], a
    ld c, a
    ld a, \3
    call SetCell
ENDM

GameTick:
    ld a, [wState]
    cp ST_READY
    jr z, .ready
    cp ST_PLAY
    jr z, .play
    cp ST_OVER
    jp z, .over
    ; ST_MATCH: either player presses A/START for a rematch
    ld a, [wP1In]
    ld b, a
    ld a, [wP2In]
    or b
    and 8
    ret z
    xor a
    ld [wScore1], a
    ld [wScore2], a
    ld [wMatchOver], a
    inc a
    ld [wReset], a
    ret

.ready:
    APPLY_INPUT wP1
    APPLY_INPUT wP2
    ld hl, wTimer
    dec [hl]
    ret nz
    ld a, ST_PLAY
    ld [wState], a
    ld a, 45
    ld [wTimer], a
    ld de, STATUS
    ld hl, strGo
    call PrintStr
    jp Beep

.play:
    ld a, [wTimer]              ; clear "GO!" after a moment
    or a
    jr z, .noclear
    dec a
    ld [wTimer], a
    jr nz, .noclear
    ld de, STATUS
    ld hl, strBlank
    call PrintStr
.noclear:
    APPLY_INPUT wP1
    APPLY_INPUT wP2
    ld hl, wMove
    dec [hl]
    ret nz
    ld [hl], SPEED
    PREP wP1
    PREP wP2
    ld a, [wP1NX]                ; head-on into the same cell: both crash
    ld b, a
    ld a, [wP2NX]
    cp b
    jr nz, .apart
    ld a, [wP1NY]
    ld b, a
    ld a, [wP2NY]
    cp b
    jr nz, .apart
    ld a, 1
    ld [wP1Crash], a
    ld [wP2Crash], a
.apart:
    ld a, [wP1Crash]
    ld b, a
    ld a, [wP2Crash]
    or b
    jr nz, .crash
    ADVANCE wP1, T_TRAIL1, T_HEAD1
    ADVANCE wP2, T_TRAIL2, T_HEAD2
    ret

.crash:
    ld a, [wP1Crash]
    or a
    jr z, .p1wins
    ld a, [wP2Crash]
    or a
    jr nz, .draw
    ld hl, wScore2
    inc [hl]
    ld hl, strP2Wins
    jr .ended
.p1wins:
    ld hl, wScore1
    inc [hl]
    ld hl, strP1Wins
    jr .ended
.draw:
    ld hl, strDraw
.ended:
    ld a, [wScore1]
    cp WIN_SCORE
    jr z, .match1
    ld a, [wScore2]
    cp WIN_SCORE
    jr nz, .show
    ld hl, strP2Champ
    jr .champ
.match1:
    ld hl, strP1Champ
.champ:
    ld a, 1
    ld [wMatchOver], a
.show:
    ld de, STATUS
    call PrintStr
    call DrawScores
    call Crash
    ld a, ST_OVER
    ld [wState], a
    ld a, 120
    ld [wTimer], a
    ret

.over:
    ld hl, wTimer
    dec [hl]
    ret nz
    ld a, [wMatchOver]
    or a
    jr nz, .matchDone
    inc a
    ld [wReset], a
    ret
.matchDone:
    ld a, ST_MATCH
    ld [wState], a
    ld de, STATUS
    ld hl, strRematch
    jp PrintStr

; ---------------- drawing ----------------

DrawArena:
    ld b, 0                     ; top and bottom walls (rows 1 and 17)
.row:
    ld c, 1
    ld a, T_WALL
    call SetCell
    ld c, 17
    ld a, T_WALL
    call SetCell
    inc b
    ld a, b
    cp 20
    jr nz, .row
    ld c, 2                     ; side walls
.col:
    ld b, 0
    ld a, T_WALL
    call SetCell
    ld b, 19
    ld a, T_WALL
    call SetCell
    inc c
    ld a, c
    cp 17
    jr nz, .col
    ld de, $9800
    ld hl, strP1
    call PrintStr
    ld de, $9800 + 16
    ld hl, strP2
    jp PrintStr

DrawScores:
    ld de, $9800 + 3
    ld a, [wScore1]
    add a, '0'
    call SafeWrite
    ld de, $9800 + 19
    ld a, [wScore2]
    add a, '0'
    jp SafeWrite

; ---------------- helpers ----------------

; hl = wGrid + c*20 + b
GridAddr:
    ld h, 0
    ld l, c
    add hl, hl
    add hl, hl
    ld d, h
    ld e, l
    add hl, hl
    add hl, hl
    add hl, de
    ld de, wGrid
    add hl, de
    ld e, b
    ld d, 0
    add hl, de
    ret

; de = $9800 + c*32 + b
MapAddr:
    ld h, 0
    ld l, c
    add hl, hl
    add hl, hl
    add hl, hl
    add hl, hl
    add hl, hl
    ld de, $9800
    add hl, de
    ld e, b
    ld d, 0
    add hl, de
    ld d, h
    ld e, l
    ret

; Puts tile a at (b, c) in both the collision grid and the BG map.
SetCell:
    push af
    call GridAddr
    pop af
    ld [hl], a
    push af
    call MapAddr
    pop af
    ; fall through
; [de] = a once VRAM is reachable (mode 0/1, or LCD off). Keeps a.
SafeWrite:
    push af
.w:
    ldh a, [rSTAT]
    and 2
    jr nz, .w
    pop af
    ld [de], a
    ret

; Prints the zero-terminated string at hl to VRAM de.
PrintStr:
    ld a, [hl+]
    or a
    ret z
    call SafeWrite
    inc de
    jr PrintStr

ClearMap:
    ld hl, $9800
    ld bc, 32 * 18
.m:
    xor a
    ld [hl+], a
    dec bc
    ld a, b
    or c
    jr nz, .m
    ld hl, wGrid
    ld bc, 20 * 18
.g:
    xor a
    ld [hl+], a
    dec bc
    ld a, b
    or c
    jr nz, .g
    ret

Copy:
    ld a, [de]
    ld [hl+], a
    inc de
    dec bc
    ld a, b
    or c
    jr nz, Copy
    ret

LcdOff:
    ldh a, [rLCDC]
    bit 7, a
    ret z
.w:
    ldh a, [rLY]
    cp 144
    jr c, .w
    ldh a, [rLCDC]
    res 7, a
    ldh [rLCDC], a
    ret

LcdOn:
    ld a, %10010001             ; LCD on, BG tiles at $8000, BG map $9800, BG on
    ldh [rLCDC], a
    ret

; wPad = held buttons (bit 0-3 right/left/up/down, 4-7 A/B/select/start), wPadNew = new presses.
ReadPad:
    ld a, $20
    ldh [rP1], a
    ldh a, [rP1]
    ldh a, [rP1]
    cpl
    and $0F
    swap a
    ld b, a
    ld a, $10
    ldh [rP1], a
    ldh a, [rP1]
    ldh a, [rP1]
    ldh a, [rP1]
    ldh a, [rP1]
    cpl
    and $0F
    or b
    swap a
    ld b, a
    ld a, $30
    ldh [rP1], a
    ld a, [wPad]
    cpl
    and b
    ld [wPadNew], a
    ld a, b
    ld [wPad], a
    ret

; a = link input code for the held buttons in wPad (never $FF). Clobbers c.
Encode:
    ld a, [wPad]
    ld c, 0
    bit 4, a
    jr nz, .fire
    bit 7, a
    jr z, .dir
.fire:
    ld c, 8
.dir:
    rra
    jr c, .r
    rra
    jr c, .l
    rra
    jr c, .u
    rra
    jr c, .d
    ld a, c
    ret
.r: ld a, 1
    or c
    ret
.l: ld a, 2
    or c
    ret
.u: ld a, 3
    or c
    ret
.d: ld a, 4
    or c
    ret

Beep:
    xor a
    ldh [rNR10], a
    ld a, $80
    ldh [rNR11], a
    ld a, $F2
    ldh [rNR12], a
    ld a, $83
    ldh [rNR13], a
    ld a, $87
    ldh [rNR14], a
    ret

Crash:
    xor a
    ldh [rNR41], a
    ld a, $F4
    ldh [rNR42], a
    ld a, $71
    ldh [rNR43], a
    ld a, $80
    ldh [rNR44], a
    ret

DirTable: ; dx, dy for right, left, up, down
    db 1, 0, -1, 0, 0, -1, 0, 1

strTitle:     db "LINK TRON", 0
strTitle2:    db "TWO PLAYERS VIA", 0
strTitle3:    db "LINK CABLE", 0
strPressStart: db "PRESS START", 0
strCredit:    db "FIRST TO 5 WINS", 0
strNoPartner: db "NO PARTNER FOUND!", 0
strYouP1:     db "YOU ARE P1", 0
strYouP2:     db "YOU ARE P2", 0
strGo:        db "   GO!    ", 0
strBlank:     db "          ", 0
strP1Wins:    db " P1 WINS! ", 0
strP2Wins:    db " P2 WINS! ", 0
strDraw:      db "   DRAW   ", 0
strP1Champ:   db "P1 CHAMPS!", 0
strP2Champ:   db "P2 CHAMPS!", 0
strRematch:   db "A:REMATCH ", 0
strP1:        db "P1:", 0
strP2:        db "P2:", 0

INCLUDE "tiles.inc"

SECTION "vars", WRAM0
wRole:      db   ; 0 = player 1 (drives the clock), 1 = player 2
wPad:       db
wPadNew:    db
wState:     db
wTimer:     db
wMove:      db
wReset:     db
wScore1:    db
wScore2:    db
wMatchOver: db
wP1X:     db
wP1Y:     db
wP1Dir:   db
wP1Next:  db
wP1NX:    db
wP1NY:    db
wP1Crash: db
wP1In:    db
wP2X:     db
wP2Y:     db
wP2Dir:   db
wP2Next:  db
wP2NX:    db
wP2NY:    db
wP2Crash: db
wP2In:    db
wGrid:    ds 20 * 18
