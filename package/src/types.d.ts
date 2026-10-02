declare module 'postcss-less' {
  import type { Root } from 'postcss'
  const syntax: { parse(source: string): Root }
  export default syntax
}
