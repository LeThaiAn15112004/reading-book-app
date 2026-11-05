import { describe, expect, it } from 'vitest'
import { formatHighlightCitation } from '../../src/app-models/highlight-citation.js'

describe('formatHighlightCitation', () => {
  it('includes author and an EPUB chapter label', () => {
    const citation = formatHighlightCitation({
      text: 'To be or not to be',
      bookTitle: 'Hamlet',
      author: 'William Shakespeare',
      locationLabel: 'Act III, Scene I',
    })

    expect(citation).toBe('"To be or not to be"\n\n— Hamlet, William Shakespeare (Act III, Scene I)')
  })

  it('includes author and a PDF page label', () => {
    const citation = formatHighlightCitation({
      text: 'Quoted text',
      bookTitle: 'Some Report',
      author: 'Jane Doe',
      locationLabel: 'p. 12',
    })

    expect(citation).toBe('"Quoted text"\n\n— Some Report, Jane Doe (p. 12)')
  })

  it('formats a multi-page PDF citation as a page range', () => {
    const citation = formatHighlightCitation({
      text: 'Quoted text',
      bookTitle: 'Some Report',
      author: 'Jane Doe',
      locationLabel: 'pp. 12–13',
    })

    expect(citation).toBe('"Quoted text"\n\n— Some Report, Jane Doe (pp. 12–13)')
  })

  it('omits the author clause when there is no author', () => {
    const citation = formatHighlightCitation({
      text: 'Quoted text',
      bookTitle: 'Some Report',
      locationLabel: 'p. 1',
    })

    expect(citation).toBe('"Quoted text"\n\n— Some Report (p. 1)')
  })

  it('omits the location parenthetical when there is no location label', () => {
    const citation = formatHighlightCitation({
      text: 'Quoted text',
      bookTitle: 'Some Report',
      author: 'Jane Doe',
    })

    expect(citation).toBe('"Quoted text"\n\n— Some Report, Jane Doe')
  })

  it('trims whitespace-only location labels and text', () => {
    const citation = formatHighlightCitation({
      text: '  Quoted text  ',
      bookTitle: 'Some Report',
      locationLabel: '   ',
    })

    expect(citation).toBe('"Quoted text"\n\n— Some Report')
  })
})
