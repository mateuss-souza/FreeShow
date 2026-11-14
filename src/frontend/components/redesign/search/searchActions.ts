// What the Search palette does with a result: add it to the open service, show it now, open it at a slide.

import { get, writable } from "svelte/store"
import type { Show } from "../../../../types/Show"
import { activePage, activeProject, activeShow, projects, selected, showsCache } from "../../../stores"
import { newToast } from "../../../utils/common"
import { history } from "../../helpers/history"
import { getLayoutRef } from "../../helpers/show"
import { startShow } from "../../helpers/showActions"
import { loadShows } from "../../helpers/setShow"
import { findSlideIndex } from "./searchModel"

export const searchPaletteOpen = writable(false)

export function addToRundown(showId: string) {
    const projectId = get(activeProject)
    const project = projectId ? get(projects)[projectId] : null
    if (!projectId || !project) {
        newToast("redesign.search_no_project")
        return false
    }
    const index = project.shows?.length || 0
    history({ id: "UPDATE", newData: { key: "shows", index, data: { id: showId } }, oldData: { id: projectId }, location: { page: "show", id: "project_ref" } })
    newToast("redesign.search_added")
    return true
}

export async function showNow(showId: string) {
    activePage.set("show")
    activeShow.set({ id: showId, type: "show" })
    await startShow(showId)
}

/** opens the show with the slide holding the matched lyrics selected (not presented) */
export async function openAtSlide(showId: string, needle: string) {
    activePage.set("show")
    activeShow.set({ id: showId, type: "show" })
    await loadShows([showId])
    const show = get(showsCache)[showId]
    if (!show) return
    const ref = getLayoutRef(showId)
    const texts = ref.map((r) => slideText(show, r.id))
    const index = findSlideIndex(texts, needle)
    if (index < 0) return
    // after the slides view has rendered the show
    setTimeout(() => {
        selected.set({ id: "slide", data: [{ index, showId }] })
        document.querySelector(".grid .selected, .slide.selected")?.scrollIntoView({ block: "center", behavior: "smooth" })
    }, 150)
}

function slideText(show: Show, slideId: string) {
    const slide = show.slides?.[slideId]
    return (slide?.items || [])
        .flatMap((item) => item?.lines || [])
        .map((line) => (line?.text || []).map((t) => t?.value || "").join(""))
        .join(" ")
}
