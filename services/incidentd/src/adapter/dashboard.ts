import { Hono } from 'hono'
import { startIncident, getIncident, listIncidents } from '../core/interactions'

const dashboardRoutes = new Hono<{ Bindings: Env }>()

dashboardRoutes.get('/', async (c) => {
    return c.json({ incidents: await listIncidents({ c }) })
})

dashboardRoutes.get('/:id', async (c) => {
    const id = c.req.param('id')
    if (!id) {
        return c.json({ error: 'ID is required' }, 400)
    }

    return c.json({ incident: await getIncident({ c, id }) })
})

dashboardRoutes.post('/:id', async (c) => {
    const id = c.req.param('id')
    if (!id) {
        return c.json({ error: 'ID is required' }, 400)
    }
    const { prompt, createdBy } = await c.req.parseBody<{
        prompt: string
        createdBy: string
    }>()
    const incident = await startIncident({ c, identifier: id, prompt, createdBy, source: 'dashboard' })
    return c.json({ incident })
})

export { dashboardRoutes }
