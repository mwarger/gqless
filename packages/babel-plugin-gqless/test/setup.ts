import generate from '@babel/generator'
import template from '@babel/template'
import { types as t } from '@babel/core'
import { NodePath } from '@babel/traverse'
import * as babel from '@babel/core'
import { Cache, FunctionAnalysis } from '../src/analysis'
import * as utils from '../src/utils'
import { invariant } from '@gqless/utils'
import { emitPreloader } from '../src/preload'
import * as _evaluate from '../src/evaluate'
import { Fields } from '../src/analysis/mixins'

type Files = Record<string, string>
// @ts-ignore
utils.findModule = (_, relativePath: string) => relativePath

const parserOpts: babel.ParserOptions = {
  plugins: ['exportNamespaceFrom', 'exportDefaultFrom'],
}

expect.addSnapshotSerializer({
  print: (path: NodePath) => generate(path.node).code,
  test: (val: any) => val instanceof NodePath,
})

expect.addSnapshotSerializer({
  test: (val: any) => val instanceof _evaluate.Record,
  print: (val: _evaluate.Record, serialize: any, indent: Function) =>
    `Record {\n${indent(
      val.keys
        .map((k) => `${serialize(k.key)}: ${serialize(k.value)}`)
        .join('\n')
    )}\n}`,
})

expect.addSnapshotSerializer({
  test: (val: any) => val instanceof Fields,
  print: (analysis: Fields, serialize: any, indent: Function) => {
    const body = Array.from(analysis.fields)
      .map(
        (field) =>
          `${field.name === 0 ? 'INDEX' : field.name}${
            field.variables
              ? `(${serialize(field.variables).replace(/^Record /, '')})`
              : ''
          } ${serialize(field)}`
      )
      .join('\n')

    return body ? `{\n${indent(body)}\n}` : `{}`
  },
})

expect.addSnapshotSerializer({
  test: (val: any) => val instanceof FunctionAnalysis,
  print: (analysis: FunctionAnalysis, serialize: any, indent: Function) =>
    `FunctionAnalysis (\n${indent(
      Array.from(analysis.params)
        .map(
          ([key, param]) =>
            `${key === null ? '...rest' : serialize(key)} -> ${serialize(
              param
            )}`
        )
        .join('\n')
    )}\n)`,
})

/**
 * Mock a FileAnalysis
 * @returns The first key in the files object
 */
export const fileAnalysis = (files: Files) => {
  const cache = new Cache(babel)

  cache.transform = (path) => {
    const file = files[path]
    invariant(file !== undefined, 'invalid module')
    return babel.transformSync(file, {
      ast: true,
      parserOpts,
    })!.ast!
  }

  return cache.getPath(Object.keys(files)[0])
}

export const scan = (files: Files, ...args: string[]) => {
  const funcAnalysis = fileAnalysis(files).getExport('default')
  invariant(funcAnalysis instanceof FunctionAnalysis)

  const pathArgs = args.map((arg) => {
    const path = new NodePath(undefined as any, undefined as any)
    path.node = template.expression(arg)()
    return path as any
  })
  funcAnalysis.scan(...pathArgs)

  return funcAnalysis
}

/**
 * Mock a FileAnalysis
 * @returns JS preload fn, generated from the default export
 */
export const preload = (files: Files, ...args: string[]) => {
  const funcAnalysis = fileAnalysis(files).getExport('default')
  invariant(funcAnalysis instanceof FunctionAnalysis)

  let preloadFn!: NodePath<t.ArrowFunctionExpression>
  babel.traverse(
    (t.file as any)(
      t.program([
        t.expressionStatement(
          t.arrowFunctionExpression([], t.blockStatement([]))
        ),
      ])
    ),
    {
      ArrowFunctionExpression: (path) => {
        preloadFn = path
      },
    }
  )

  const pathArgs = args.map((arg) => {
    const path = new NodePath(undefined as any, undefined as any)
    path.node = template.expression(arg)()
    return path as any
  })
  funcAnalysis.scan(...pathArgs)
  emitPreloader(preloadFn, funcAnalysis, pathArgs)
  return preloadFn
}

/**
 * Mock an evaluation
 * @returns The result of evaluating the last ExpressionStatement
 */
export const evaluate = (source: string) => {
  const bodyPath = getProgram(source).get('body')

  const expressionStatement = bodyPath[bodyPath.length - 1]
  invariant(expressionStatement.isExpressionStatement())

  const path = expressionStatement.get('expression')
  return _evaluate.evaluate(path)
}

export const getProgram = (source: string) => {
  let programPath: NodePath<t.Program>
  babel.traverse(babel.parse(source, { parserOpts })!, {
    Program: (path) => {
      programPath = path
    },
  })
  return programPath
}
