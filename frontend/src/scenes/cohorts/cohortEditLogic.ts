import { actions, afterMount, beforeUnmount, connect, kea, key, listeners, path, props, reducers, selectors } from 'kea'
import api from 'lib/api'
import { cohortsModel } from '~/models/cohortsModel'
import { ENTITY_MATCH_TYPE, FEATURE_FLAGS } from 'lib/constants'
import {
    AnyCohortCriteriaType,
    AnyCohortGroupType,
    CohortCriteriaGroupFilter,
    CohortGroupType,
    CohortType,
    FilterLogicalOperator,
    PropertyFilterType,
} from '~/types'
import { personsLogic } from 'scenes/persons/personsLogic'
import { lemonToast } from 'lib/lemon-ui/lemonToast'
import { urls } from 'scenes/urls'
import { actionToUrl, router } from 'kea-router'
import { loaders } from 'kea-loaders'
import { forms } from 'kea-forms'
import {
    applyAllCriteriaGroup,
    applyAllNestedCriteria,
    cleanCriteria,
    createCohortFormData,
    isCohortCriteriaGroup,
    validateGroup,
} from 'scenes/cohorts/cohortUtils'
import { NEW_COHORT, NEW_CRITERIA, NEW_CRITERIA_GROUP } from 'scenes/cohorts/CohortFilters/constants'
import type { cohortEditLogicType } from './cohortEditLogicType'
import { CohortLogicProps } from 'scenes/cohorts/cohortLogic'
import { processCohort } from 'lib/utils'
import { DataTableNode, Node, NodeKind } from '~/queries/schema'
import { isDataTableNode } from '~/queries/utils'
import { featureFlagLogic } from 'lib/logic/featureFlagLogic'

export const cohortEditLogic = kea<cohortEditLogicType>([
    props({} as CohortLogicProps),
    key((props) => props.id || 'new'),
    path(['scenes', 'cohorts', 'cohortLogicEdit']),
    connect(() => ({
        values: [featureFlagLogic, ['featureFlags']],
    })),

    actions({
        saveCohort: (cohortParams = {}) => ({ cohortParams }),
        setCohort: (cohort: CohortType) => ({ cohort }),
        deleteCohort: true,
        fetchCohort: (id: CohortType['id']) => ({ id }),
        setCohortMissing: true,
        onCriteriaChange: (newGroup: Partial<CohortGroupType>, id: string) => ({ newGroup, id }),
        setPollTimeout: (pollTimeout: number | null) => ({ pollTimeout }),
        checkIfFinishedCalculating: (cohort: CohortType) => ({ cohort }),

        setOuterGroupsType: (type: FilterLogicalOperator) => ({ type }),
        setInnerGroupType: (type: FilterLogicalOperator, groupIndex: number) => ({ type, groupIndex }),
        duplicateFilter: (groupIndex: number, criteriaIndex?: number) => ({ groupIndex, criteriaIndex }),
        addFilter: (groupIndex?: number) => ({ groupIndex }),
        removeFilter: (groupIndex: number, criteriaIndex?: number) => ({ groupIndex, criteriaIndex }),
        setCriteria: (newCriteria: AnyCohortCriteriaType, groupIndex: number, criteriaIndex: number) => ({
            newCriteria,
            groupIndex,
            criteriaIndex,
        }),
        setQuery: (query: Node) => ({ query }),
        duplicateCohort: (asStatic: boolean) => ({ asStatic }),
    }),

    selectors({
        usePersonsQuery: [(s) => [s.featureFlags], (featureFlags) => featureFlags[FEATURE_FLAGS.PERSONS_HOGQL_QUERY]],
    }),

    reducers(({ props, selectors }) => ({
        cohort: [
            NEW_COHORT as CohortType,
            {
                setOuterGroupsType: (state, { type }) => ({
                    ...state,
                    filters: {
                        properties: {
                            ...state.filters.properties,
                            type,
                        },
                    },
                }),
                setInnerGroupType: (state, { type, groupIndex }) =>
                    applyAllCriteriaGroup(
                        state,
                        (groupList) =>
                            groupList.map((group, groupI) =>
                                groupI === groupIndex ? { ...group, type } : group
                            ) as CohortCriteriaGroupFilter[]
                    ),
                duplicateFilter: (state, { groupIndex, criteriaIndex }) => {
                    if (criteriaIndex !== undefined) {
                        return applyAllNestedCriteria(
                            state,
                            (criteriaList) => [
                                ...criteriaList.slice(0, criteriaIndex),
                                criteriaList[criteriaIndex],
                                ...criteriaList.slice(criteriaIndex),
                            ],
                            groupIndex
                        )
                    }
                    return applyAllCriteriaGroup(state, (groupList) => [
                        ...groupList.slice(0, groupIndex),
                        groupList[groupIndex],
                        ...groupList.slice(groupIndex),
                    ])
                },
                addFilter: (state, { groupIndex }) => {
                    if (groupIndex !== undefined) {
                        return applyAllNestedCriteria(
                            state,
                            (criteriaList) => [...criteriaList, NEW_CRITERIA],
                            groupIndex
                        )
                    }
                    return applyAllCriteriaGroup(state, (groupList) => [...groupList, NEW_CRITERIA_GROUP])
                },
                removeFilter: (state, { groupIndex, criteriaIndex }) => {
                    if (criteriaIndex !== undefined) {
                        return applyAllNestedCriteria(
                            state,
                            (criteriaList) => [
                                ...criteriaList.slice(0, criteriaIndex),
                                ...criteriaList.slice(criteriaIndex + 1),
                            ],
                            groupIndex
                        )
                    }
                    return applyAllCriteriaGroup(state, (groupList) => [
                        ...groupList.slice(0, groupIndex),
                        ...groupList.slice(groupIndex + 1),
                    ])
                },
                setCriteria: (state, { newCriteria, groupIndex, criteriaIndex }) =>
                    applyAllNestedCriteria(
                        state,
                        (criteriaList) =>
                            criteriaList.map((oldCriteria, criteriaI) =>
                                isCohortCriteriaGroup(oldCriteria)
                                    ? oldCriteria
                                    : criteriaI === criteriaIndex
                                    ? cleanCriteria({ ...oldCriteria, ...newCriteria })
                                    : oldCriteria
                            ),
                        groupIndex
                    ),
            },
        ],
        cohortMissing: [
            false,
            {
                setCohortMissing: () => true,
            },
        ],
        pollTimeout: [
            null as number | null,
            {
                setPollTimeout: (_, { pollTimeout }) => pollTimeout,
            },
        ],
        query: [
            ((state: Record<string, any>) =>
                selectors.usePersonsQuery(state)
                    ? {
                          kind: NodeKind.DataTableNode,
                          source: {
                              kind: NodeKind.PersonsQuery,
                              fixedProperties: [
                                  { type: PropertyFilterType.Cohort, key: 'id', value: parseInt(String(props.id)) },
                              ],
                          },
                          full: true,
                      }
                    : {
                          kind: NodeKind.DataTableNode,
                          source: {
                              kind: NodeKind.PersonsNode,
                              cohort: props.id,
                          },
                          columns: undefined,
                          full: true,
                      }) as any as DataTableNode,
            {
                setQuery: (state, { query }) => (isDataTableNode(query) ? query : state),
            },
        ],
    })),

    forms(({ actions }) => ({
        cohort: {
            defaults: NEW_COHORT,
            errors: ({ id, name, csv, is_static, filters }) => ({
                name: !name ? 'Cohort name cannot be empty' : undefined,
                csv: is_static && id === 'new' && !csv ? 'You need to upload a CSV file' : (null as any),
                filters: {
                    properties: {
                        values: is_static ? undefined : filters.properties.values.map(validateGroup),
                    },
                },
            }),
            submit: (cohort) => {
                actions.saveCohort(cohort)
            },
        },
    })),

    loaders(({ actions, values, key }) => ({
        cohort: [
            NEW_COHORT as CohortType,
            {
                setCohort: ({ cohort }) => processCohort(cohort),
                fetchCohort: async ({ id }, breakpoint) => {
                    try {
                        const cohort = await api.cohorts.get(id)
                        breakpoint()
                        cohortsModel.actions.updateCohort(cohort)
                        actions.checkIfFinishedCalculating(cohort)
                        return processCohort(cohort)
                    } catch (error: any) {
                        lemonToast.error(error.detail || 'Failed to fetch cohort')

                        actions.setCohortMissing()
                        return values.cohort
                    }
                },
                saveCohort: async ({ cohortParams }, breakpoint) => {
                    let cohort = { ...cohortParams }
                    const cohortFormData = createCohortFormData(cohort)

                    try {
                        if (cohort.id !== 'new') {
                            cohort = await api.cohorts.update(cohort.id, cohortFormData as Partial<CohortType>)
                            cohortsModel.actions.updateCohort(cohort)
                        } else {
                            cohort = await api.cohorts.create(cohortFormData as Partial<CohortType>)
                            cohortsModel.actions.cohortCreated(cohort)
                        }
                    } catch (error: any) {
                        breakpoint()
                        lemonToast.error(error.detail || 'Failed to save cohort')
                        return values.cohort
                    }

                    cohort.is_calculating = true // this will ensure there is always a polling period to allow for backend calculation task to run
                    breakpoint()
                    delete cohort['csv']
                    actions.setCohort(cohort)
                    lemonToast.success('Cohort saved. Please wait up to a few minutes for it to be calculated', {
                        toastId: `cohort-saved-${key}`,
                    })
                    actions.checkIfFinishedCalculating(cohort)
                    return processCohort(cohort)
                },
                onCriteriaChange: ({ newGroup, id }) => {
                    const cohort = { ...values.cohort }
                    const index = cohort.groups.findIndex((group: AnyCohortGroupType) => group.id === id)
                    if (newGroup.matchType) {
                        cohort.groups[index] = {
                            id: cohort.groups[index].id,
                            matchType: ENTITY_MATCH_TYPE,
                            ...newGroup,
                        }
                    } else {
                        cohort.groups[index] = {
                            ...cohort.groups[index],
                            ...newGroup,
                        }
                    }
                    return processCohort(cohort)
                },
            },
        ],
        duplicatedCohort: [
            null as CohortType | null,
            {
                duplicateCohort: async ({ asStatic }: { asStatic: boolean }, breakpoint) => {
                    let cohort: CohortType
                    try {
                        await breakpoint(200)
                        if (asStatic) {
                            cohort = await api.cohorts.duplicate(values.cohort.id)
                        } else {
                            const data = { ...values.cohort }
                            data.name += ' (dynamic copy)'
                            cohort = await api.cohorts.create(data)
                        }
                        lemonToast.success(
                            'Cohort duplicated. Please wait up to a few minutes for it to be calculated',
                            {
                                toastId: `cohort-duplicated-${cohort.id}`,
                                button: {
                                    label: 'View cohort',
                                    action: () => {
                                        router.actions.push(urls.cohort(cohort.id))
                                    },
                                },
                            }
                        )
                        return cohort
                    } catch (error: any) {
                        lemonToast.error(error.detail || 'Failed to duplicate cohort')
                        return null
                    }
                },
            },
        ],
    })),
    listeners(({ actions, values, key }) => ({
        deleteCohort: () => {
            cohortsModel.findMounted()?.actions.deleteCohort({ id: values.cohort.id, name: values.cohort.name })
            router.actions.push(urls.cohorts())
        },
        checkIfFinishedCalculating: async ({ cohort }, breakpoint) => {
            if (cohort.is_calculating) {
                actions.setPollTimeout(
                    window.setTimeout(async () => {
                        const newCohort = await api.cohorts.get(cohort.id)
                        breakpoint()
                        actions.checkIfFinishedCalculating(newCohort)
                    }, 1000)
                )
            } else {
                actions.setCohort(cohort)
                cohortsModel.actions.updateCohort(cohort)
                personsLogic.findMounted({ syncWithUrl: true })?.actions.loadCohorts() // To ensure sync on person page
                if (values.pollTimeout) {
                    clearTimeout(values.pollTimeout)
                    actions.setPollTimeout(null)
                }
                if ((cohort.errors_calculating ?? 0) > 0) {
                    lemonToast.error(
                        'Cohort error. There was an error calculating this cohort. Make sure the cohort filters are correct.',
                        {
                            toastId: `cohort-calculation-error-${key}`,
                        }
                    )
                }
            }
        },
    })),

    actionToUrl(({ values }) => ({
        saveCohortSuccess: () => urls.cohort(values.cohort.id),
    })),

    afterMount(({ actions, props }) => {
        if (!props.id || props.id === 'new') {
            actions.setCohort(NEW_COHORT)
        } else {
            actions.fetchCohort(props.id)
        }
    }),
    beforeUnmount(({ values }) => {
        if (values.pollTimeout) {
            clearTimeout(values.pollTimeout)
        }
    }),
])
