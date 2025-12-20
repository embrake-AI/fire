import { Hono } from 'hono'
import { slackRoutes } from './adapter/slack'
import { dashboardRoutes } from './adapter/dashboard'
export { Incident } from './core/incident'
const app = new Hono<{ Bindings: Env }>()

app.route('/slack', slackRoutes)
app.route('/dashboard', dashboardRoutes)




export default app
