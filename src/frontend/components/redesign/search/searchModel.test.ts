import { describe, expect, it } from "vitest"
import { buildArtistIndex, findSlideIndex, highlight, initials, normalize, searchLibrary, snippet, splitNames, tokens } from "./searchModel"

const shows = [
    { id: "a", name: "Rio de Graça", timestamps: { used: 300 } },
    { id: "b", name: "O Rio da Vida", timestamps: { used: 100 } },
    { id: "c", name: "Caminho Aberto", timestamps: { used: 200 } },
    { id: "d", name: "Manancial", timestamps: { used: 0 } },
    { id: "e", name: "Segredo", private: true }
]
const text = {
    a: "teu amor corre como um rio enche o vale e a manhã",
    c: "como um rio que encontra o mar pedras velhas no deserto",
    d: "flua em mim do manancial",
    e: "como um rio escondido"
}
const meta = {
    a: { artist: "Fonte Viva", key: "G" },
    b: { artist: "Coral Esperança", author: "Marta Rios" },
    c: { artist: "Fonte Viva", composer: "Ana Lima, Marta Rios" },
    d: {}
}

describe("normalizing and highlighting", () => {
    it("ignores case, accents and punctuation", () => {
        expect(normalize("Graça, É  Sublime!")).toBe("graca e sublime")
        expect(tokens("  rio  GRAÇA ")).toEqual(["rio", "graca"])
    })
    it("marks matches in the original text, accents included", () => {
        expect(highlight("Rio de Graça", ["graca"])).toEqual([
            { text: "Rio de ", hit: false },
            { text: "Graça", hit: true }
        ])
        expect(
            highlight("O Rio da Vida", ["rio"])
                .filter((p) => p.hit)
                .map((p) => p.text)
        ).toEqual(["Rio"])
    })
})

describe("searchLibrary", () => {
    it("finds titles, best match first, never private shows", () => {
        const r = searchLibrary({ query: "rio", shows, text, meta })
        expect(r.titles.map((t) => t.id)).toEqual(["a", "b"])
        expect(r.titles[0].meta.key).toBe("G")
    })
    it("finds lyrics as a phrase, with the lines around it", () => {
        const r = searchLibrary({ query: "como um rio", shows, text, meta })
        expect(r.lyrics.map((l) => l.id)).toEqual(["a", "c"])
        expect(r.lyrics[0].parts.find((p) => p.hit)?.text).toBe("como um rio")
        expect(r.counts.lyrics).toBe(2)
    })
    it("needs three letters before searching lyrics", () => {
        expect(searchLibrary({ query: "um", shows, text, meta }).lyrics).toEqual([])
    })
    it("finds artists, authors and composers, accent-insensitive, with their songs", () => {
        const r = searchLibrary({ query: "rios", shows, text, meta })
        expect(r.artists.map((a) => [a.name, a.role, a.showIds.length])).toEqual([["Marta Rios", "author", 2]])
        const band = searchLibrary({ query: "esperanca", shows, text, meta }).artists[0]
        expect([band.name, band.role]).toEqual(["Coral Esperança", "artist"])
    })
    it("lists all songs of one artist", () => {
        const r = searchLibrary({ query: "", shows, text, meta, artistKey: "fonte viva" })
        expect(r.titles.map((t) => t.name)).toEqual(["Caminho Aberto", "Rio de Graça"])
    })
    it("returns nothing for an empty query", () => {
        expect(searchLibrary({ query: "  ", shows, text, meta }).counts).toEqual({ titles: 0, lyrics: 0, artists: 0 })
    })
})

describe("helpers", () => {
    it("splits credits holding several people", () => {
        expect(splitNames("Ana Lima, Marta Rios & João feat. Zé")).toEqual(["Ana Lima", "Marta Rios", "João", "Zé"])
        expect(buildArtistIndex(shows, meta).get("ana lima")?.showIds.size).toBe(1)
    })
    it("cuts a snippet at word boundaries", () => {
        const long = "primeira linha da canção bem longa aqui e então teu amor corre como um rio enche o vale e a manhã e muito mais texto depois disso"
        const parts = snippet(long, ["rio"], "rio", 20)
        expect(parts[0].text).toBe("…")
        expect(parts.map((p) => p.text).join("")).toContain("como um rio enche")
    })
    it("finds the slide holding the matched line", () => {
        expect(findSlideIndex(["Na beira do caminho", "Teu amor corre como um rio"], "como um rio")).toBe(1)
        expect(findSlideIndex(["nada"], "rio")).toBe(-1)
    })
    it("makes initials", () => {
        expect(initials("Rio Claro Worship")).toBe("RW")
        expect(initials("Marta")).toBe("MA")
    })
})
